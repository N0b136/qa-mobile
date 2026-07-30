// The console's end of an actual cable.
//
// This is deliberately the thinnest thing that can call itself a `HubTransport`:
// bytes in, bytes out, and a note when it dies. NOTHING above it changes when it
// is swapped in for the simulator, because `hubLink` already owns the line
// assembler, the 16384-character line cap, the 120-frames-per-second inbound
// cap, the write queue and the reconnect ladder. A second copy of any of those
// down here would give the park two limits that drift apart, and the one that
// fired first would be a limit nobody remembers writing.
//
// The wire is PROTOCOL.md §6: 115200 8N1, one JSON object per line, printable
// ASCII, `\n` terminated. Cleartext, because USB is a wire in a locked booth —
// the radio half is the half that is encrypted, and the hub strips every trace
// of it before printing a byte here.
//
// ── WHY THIS ONE CANNOT ATTACH ITSELF ───────────────────────────────────────
//
// `navigator.serial.requestPort()` requires transient user activation: it opens
// the browser's port picker, and a browser will only do that inside the turn of
// an event a human caused. So a serial hub can never be connected from an
// effect the way the simulator is — there has to be a button, and the call has
// to happen in the click handler with nothing awaited in front of it, or the
// activation has already expired by the time we ask and Chrome answers with a
// SecurityError that reads, wrongly, as "permission refused".
//
// ── WHY THE GRANTED PORT IS KEPT ────────────────────────────────────────────
//
// The picker is a ONE-TIME grant, not a per-open one. The `SerialPort` object is
// held after the first grant so `hubLink`'s reconnect ladder — which runs on a
// timer, seconds or minutes after any click — can reopen the same cable with no
// gesture and no second picker. A Warden who nudges the cable back in gets the
// park back on its own. A Warden who has to answer a browser dialog every eight
// seconds while the taps pile up does not.

import * as hubLink from './hubLink'
import type { HubTransport, HubTransportHandlers } from './hubLink'

/** PROTOCOL.md §6. The hub's UART is fixed at this rate; there is nothing to negotiate. */
const BAUD = 115200

// ── The slice of Web Serial we actually use ─────────────────────────────────
//
// TypeScript's DOM library still does not ship Web Serial, and pulling a whole
// `@types` package in for four members would be a dependency for nothing. These
// are structural declarations of exactly what this file touches, and nothing
// wider — anything else the API can do is not this transport's business.
//
// `readable`/`writable` are typed as `BufferSource` streams rather than
// `Uint8Array` ones so `pipeTo(TextDecoderStream.writable)` type-checks against
// lib.dom's own declaration of that stream.

interface SerialPortLike {
  readonly readable: ReadableStream<BufferSource> | null
  readonly writable: WritableStream<BufferSource> | null
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
}

interface SerialLike {
  requestPort(): Promise<SerialPortLike>
}

function serialApi(): SerialLike | null {
  if (typeof navigator === 'undefined') return null
  const nav = navigator as Navigator & { serial?: SerialLike }
  return nav.serial ?? null
}

/**
 * Turn whatever the browser threw into the one word `hubLink` acts on.
 *
 * This mapping is worth getting exactly right, because each branch puts
 * different words in front of a member of staff standing in a booth:
 *
 *   NotFoundError    the picker was dismissed — nothing was chosen, no fault
 *   InvalidStateError / NetworkError   the port would not open for us
 *   SecurityError / NotAllowedError    permission refused
 *   anything else    unknown, and said so rather than guessed at
 *
 * A note on the busy branch: Chrome raises `NetworkError` both when another tab
 * or a serial monitor already holds the port AND when the named device is no
 * longer on the bus at all. The two are indistinguishable from here, so the
 * message names the cable as well as the other window — telling a Warden to go
 * hunt for a tab they never opened is worse than telling them to check two
 * things.
 */
function openFailure(err: unknown): hubLink.HubOpenError {
  // Our own refusals travel as HubOpenError already; do not re-wrap them.
  if (err instanceof hubLink.HubOpenError) return err

  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.name : ''
  switch (name) {
    case 'NotFoundError':
      return new hubLink.HubOpenError('cancelled', 'No port was chosen.')
    case 'InvalidStateError':
    case 'NetworkError':
      return new hubLink.HubOpenError('held', 'The port is busy — another window may hold it, or the cable is out.')
    case 'SecurityError':
    case 'NotAllowedError':
      return new hubLink.HubOpenError('denied', 'This page is not allowed to use the serial port.')
    default: {
      const detail = err instanceof Error && err.message ? err.message : 'The hub would not open.'
      return new hubLink.HubOpenError('error', detail)
    }
  }
}

/**
 * A real hub on a USB cable. Implements `HubTransport` and nothing more, so the
 * simulated path and this one exercise byte-identical NDJSON through the same
 * codec, the same assembler and the same state machine.
 */
export class SerialTransport implements HubTransport {
  readonly kind = 'serial' as const
  readonly label = 'USB serial'

  /** Kept across closes: the picker grant is one-time, the reconnects are not. */
  private port: SerialPortLike | null = null
  private reader: ReadableStreamDefaultReader<string> | null = null
  private writer: WritableStreamDefaultWriter<BufferSource> | null = null
  /**
   * Settles when the byte pipe into the decoder has finished. `port.close()`
   * REJECTS while `port.readable` is still locked, so this has to be awaited
   * during teardown — skip it and the next reconnect finds a port it can
   * neither use nor reopen.
   */
  private pipeDone: Promise<void> | null = null
  private handlers: HubTransportHandlers | null = null
  private encoder = new TextEncoder()
  /**
   * True only while WE are the ones closing. This is the single input to the
   * `expected` flag on `onClosed`, and `hubLink` drives its whole reconnect
   * ladder off that distinction: report a yanked cable as expected and the park
   * never comes back on its own; report a sign-out as unexpected and the
   * console reopens a port the staff session behind it no longer justifies.
   */
  private closing = false
  /** In-flight teardown, so close() is idempotent however many callers race. */
  private teardownPromise: Promise<void> | null = null

  // ── HubTransport ──────────────────────────────────────────────────────────

  /**
   * False in every non-Chromium browser, in the sandbox, and on any page that
   * is not a secure context. The console shows the simulator affordance instead
   * of a button that could only ever fail.
   */
  supported(): boolean {
    return serialApi() !== null
  }

  async open(handlers: HubTransportHandlers): Promise<void> {
    const serial = serialApi()
    if (!serial) {
      throw new hubLink.HubOpenError('unsupported', 'This browser cannot open a serial port.')
    }

    // A teardown still settling would be racing the open below for the same
    // port object. Let it finish; it never rejects.
    if (this.teardownPromise) await this.teardownPromise

    this.closing = false
    this.handlers = handlers

    let port = this.port
    if (!port) {
      // THE GESTURE IS SPENT HERE. Nothing may be awaited before this line on
      // the first open of a session, or the picker never appears.
      try {
        port = await serial.requestPort()
      } catch (err) {
        this.handlers = null
        throw openFailure(err)
      }
      this.port = port
    }

    try {
      await port.open({ baudRate: BAUD })
    } catch (err) {
      this.handlers = null
      throw openFailure(err)
    }

    const readable = port.readable
    const writable = port.writable
    if (!readable || !writable) {
      // Opened, but with no streams to speak through — a port in this state is
      // useless and would otherwise sit there looking connected.
      await this.close()
      throw new hubLink.HubOpenError('error', 'The port opened with nothing to read.')
    }

    // Bytes to text, and no further. Splitting these chunks into lines is
    // `hubLink.ingest`'s job — a chunk boundary lands wherever the USB stack
    // felt like putting it and has nothing to do with a frame boundary.
    const decoder = new TextDecoderStream()
    this.pipeDone = readable.pipeTo(decoder.writable).catch(() => {
      // The pipe errors the moment the cable goes. The read loop below sees the
      // same fault and is the one that reports it, so this only stops an
      // unhandled rejection.
    })
    const reader = decoder.readable.getReader()
    this.reader = reader
    this.writer = writable.getWriter()

    // Detached ON PURPOSE: `open()` resolves once the far end is readable, and
    // the loop below then runs for the life of the connection. Awaiting it here
    // would mean `open()` only resolved once the hub had already gone away.
    void this.readLoop(reader)
  }

  /**
   * Idempotent, and it does not throw — every call site reaches it on the path
   * where the cable has ALREADY been yanked, and a teardown that throws there
   * would leave `hubLink` holding a transport it believes is still alive.
   */
  async close(): Promise<void> {
    this.closing = true
    await this.teardown()
  }

  /** One complete line, newline included — `hubLink` guarantees both. */
  async write(text: string): Promise<void> {
    const writer = this.writer
    if (!writer) throw new Error('the serial port is not open')
    // Straight out. No length cap and no frame counting here: `hubLink` capped
    // and counted this line before it ever reached the queue.
    await writer.write(this.encoder.encode(text))
  }

  // ── The read loop ─────────────────────────────────────────────────────────

  private async readLoop(reader: ReadableStreamDefaultReader<string>): Promise<void> {
    // Held locally for the life of THIS connection. Teardown clears the field,
    // and a deliberate close() tears down before the loop notices — so reading
    // `this.handlers` in the finally below would silently swallow the one
    // `onClosed(true)` that tells `hubLink` the close was ours.
    const handlers = this.handlers
    let detail: string | undefined
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) handlers?.onChunk(value)
      }
    } catch (err) {
      // The ordinary end of a cable's life: unplugged mid-shift, hub rebooted,
      // driver dropped it. Not an exception worth logging as a bug.
      detail = err instanceof Error && err.message ? err.message : 'The hub stopped answering.'
    } finally {
      // Read once, here: a close() racing us would flip `closing` after the
      // fact, and this loop's ending belongs to the state it ended in.
      const expected = this.closing
      try {
        reader.releaseLock()
      } catch {
        // Already released by the cancel in teardown(). Nothing to do.
      }
      if (!expected) {
        // Tidy the port so the reconnect ladder has something reopenable to
        // come back to — but do not make `hubLink` wait on it. The ladder's
        // first rung is a second away and teardown is far quicker than that.
        void this.teardown()
      }
      handlers?.onClosed(expected, detail)
    }
  }

  private teardown(): Promise<void> {
    if (!this.teardownPromise) {
      this.teardownPromise = this.doTeardown().finally(() => {
        this.teardownPromise = null
      })
    }
    return this.teardownPromise
  }

  /**
   * Give every lock back, in the one order that works, and swallow everything.
   *
   * Order matters: the reader is cancelled first so the pipe unwinds, the pipe
   * is awaited so `port.readable` is unlocked, the writer is aborted and
   * released so `port.writable` is unlocked, and only then will `port.close()`
   * resolve rather than reject with "the port is locked".
   *
   * `this.port` is deliberately NOT cleared — see the note at the top of the
   * file. The grant is what we are keeping.
   */
  private async doTeardown(): Promise<void> {
    const reader = this.reader
    const writer = this.writer
    const pipeDone = this.pipeDone
    const port = this.port
    this.reader = null
    this.writer = null
    this.pipeDone = null
    this.handlers = null

    if (reader) {
      try {
        await reader.cancel()
      } catch {
        // Already errored out with the cable. The lock goes either way.
      }
    }
    if (pipeDone) await pipeDone
    if (writer) {
      try {
        // abort() rather than close(): close() waits for a sink that, on a
        // yanked cable, is never going to drain.
        await writer.abort()
      } catch {
        // Gone. Fall through to the release.
      }
      try {
        writer.releaseLock()
      } catch {
        // Released with the abort. Nothing to do.
      }
    }
    if (port) {
      try {
        await port.close()
      } catch {
        // A port whose device has been removed refuses to close. The next
        // open() re-opens it; there is nothing to report and nobody to report
        // it to.
      }
    }
  }
}
