// station_clips.h — GENERATED, DO NOT EDIT.
//
// Regenerate with:  npm run fw:clips      (node firmware/tools/gen-clip-map.mjs)
// Verify with:      node firmware/tools/gen-clip-map.mjs --check
//
// Source of truth: content-intake/season-1.json, cross-asserted slot for slot
// against questland/src/content/stations.ts (EPISODE_STATIONS) and quests.ts.
// Canon fingerprint: 132EB1DA89E208F5
//
// ── The addressing ─────────────────────────────────────────────────────────
//
//   folder = order   1 Rangers of Questia, 2 Hearers of the Alehiim, 3 Order of the Elm
//   track  = episode number, 1..10
//
// The two fields that ride the LoRa wire ARE the two arguments to
// df.playFolder(). Resolution is a struct copy, not a lookup.
//
// ── THE GAPS ARE THE POINT ─────────────────────────────────────────────────
//
// Every card is sparse and that is correct. Track number is pinned to episode
// number FOREVER, so adding a station to a new rotation is ONE FILE DROP onto
// one card. Pack the tracks 001..00N instead and the same edit renumbers every
// file after it on that card, and on every card sharing the episode, and the
// firmware needs a per-station index that can drift from the SD contents with
// nothing able to notice. Do not "tidy" the gaps.
//
// ── Shape ──────────────────────────────────────────────────────────────────
//
// QL_CLIP_KEYS is one flat, ascending array of (folder << 8) | track. The keys
// for station N occupy the half-open range
//     [ QL_CLIP_INDEX[N], QL_CLIP_INDEX[N + 1] )
// so station.ino binary-searches a run. An EMPTY RUN IS LEGAL and means "this
// card carries ambience and system audio only":
//     station 0            the hub, which has no card;
//     station 22           the Chief's House — the quest start, not one of the
//                          canon 21, on no rotation, earning no seal. If the park
//                          ever wants the chief to speak the episode brief, that
//                          is 30 new recordings and a line in this generator; it
//                          is empty because no such content exists, not by
//                          oversight;
//     station 23           the gate / Village of Queston, likewise.
//
// Folder 4 (RAID: Brigand's Return) is allocated on the wire and deliberately
// unpopulated: the finale is prose in season-1.json with no station assignment
// to generate from. Emitting a guess here would be a fallback clip by another
// name, which is exactly what the no-fallback mandate forbids.

#pragma once

#include <stdint.h>

#define QL_CLIPS_FORMAT 1
#define QL_CLIP_STATION_MAX 23

/** Canon this card set was cut from. Printed on every sdcard-manifests/st-NN.txt. */
#define QL_CLIP_CANON "132EB1DA89E208F5"

#define QL_CLIP_TOTAL 210

static const uint16_t QL_CLIP_KEYS[QL_CLIP_TOTAL] = {
  //  1 st-01 Hidden in Plain Sight (puzzle) - 10 clips  1:{4,6,9} 2:{3,7} 3:{1,2,5,8,10}
  0x0104, 0x0106, 0x0109, 0x0203, 0x0207, 0x0301, 0x0302, 0x0305, 0x0308, 0x030A,
  //  2 st-02 Maker's Tent (craft) - 10 clips  1:{1,4,6,9} 2:{3,7} 3:{2,5,8,10}
  0x0101, 0x0104, 0x0106, 0x0109, 0x0203, 0x0207, 0x0302, 0x0305, 0x0308, 0x030A,
  //  3 st-03 Songcircle (song) - 11 clips  1:{1,3,4,6,9} 2:{2,7} 3:{2,5,8,10}
  0x0101, 0x0103, 0x0104, 0x0106, 0x0109, 0x0202, 0x0207, 0x0302, 0x0305, 0x0308,
  0x030A,
  //  4 st-04 Riddlebridge (riddle) - 10 clips  1:{2,4,9} 2:{3,6} 3:{1,5,7,8,10}
  0x0102, 0x0104, 0x0109, 0x0203, 0x0206, 0x0301, 0x0305, 0x0307, 0x0308, 0x030A,
  //  5 st-05 Coolcreek Stone (puzzle) - 10 clips  1:{3,7} 2:{1,2,5,6,8,10} 3:{4,9}
  0x0103, 0x0107, 0x0201, 0x0202, 0x0205, 0x0206, 0x0208, 0x020A, 0x0304, 0x0309,
  //  6 st-06 Brigand's Hideout (obstacle) - 10 clips  1:{1,3,6,10} 2:{4,7,9} 3:{2,5,8}
  0x0101, 0x0103, 0x0106, 0x010A, 0x0204, 0x0207, 0x0209, 0x0302, 0x0305, 0x0308,
  //  7 st-07 Abbey Hill Ruins (story) - 10 clips  1:{1,4,6,9} 2:{8,10} 3:{2,3,5,7}
  0x0101, 0x0104, 0x0106, 0x0109, 0x0208, 0x020A, 0x0302, 0x0303, 0x0305, 0x0307,
  //  8 st-08 Songhollow Cave (song) - 9 clips  1:{7,10} 2:{3,5,8} 3:{1,4,6,9}
  0x0107, 0x010A, 0x0203, 0x0205, 0x0208, 0x0301, 0x0304, 0x0306, 0x0309,
  //  9 st-09 Story Willow (story) - 10 clips  1:{2,5,8,10} 2:{1,3,4,7} 3:{6,9}
  0x0102, 0x0105, 0x0108, 0x010A, 0x0201, 0x0203, 0x0204, 0x0207, 0x0306, 0x0309,
  // 10 st-10 Southfork (obstacle) - 10 clips  1:{4,8} 2:{1,2,5,10} 3:{3,6,7,9}
  0x0104, 0x0108, 0x0201, 0x0202, 0x0205, 0x020A, 0x0303, 0x0306, 0x0307, 0x0309,
  // 11 st-11 Hillward Outpost (puzzle) - 10 clips  1:{1,2,5,8,10} 2:{4,9} 3:{3,6,7}
  0x0101, 0x0102, 0x0105, 0x0108, 0x010A, 0x0204, 0x0209, 0x0303, 0x0306, 0x0307,
  // 12 st-12 Shadetree Hollow (riddle) - 10 clips  1:{3,6,7} 2:{1,5,8,10} 3:{2,4,9}
  0x0103, 0x0106, 0x0107, 0x0201, 0x0205, 0x0208, 0x020A, 0x0302, 0x0304, 0x0309,
  // 13 st-13 Path's Cross (obstacle) - 10 clips  1:{2,5,7,9} 2:{3,6,8} 3:{1,4,10}
  0x0102, 0x0105, 0x0107, 0x0109, 0x0203, 0x0206, 0x0208, 0x0301, 0x0304, 0x030A,
  // 14 st-14 Wonder's Hut (riddle) - 10 clips  1:{1,5,8,10} 2:{2,4,7,9} 3:{3,6}
  0x0101, 0x0105, 0x0108, 0x010A, 0x0202, 0x0204, 0x0207, 0x0209, 0x0303, 0x0306,
  // 15 st-15 Maker's Cave (craft) - 10 clips  1:{3,7} 2:{1,2,5,8,10} 3:{4,6,9}
  0x0103, 0x0107, 0x0201, 0x0202, 0x0205, 0x0208, 0x020A, 0x0304, 0x0306, 0x0309,
  // 16 st-16 Story Oak (story) - 10 clips  1:{3,7} 2:{2,5,6,9} 3:{1,4,8,10}
  0x0103, 0x0107, 0x0202, 0x0205, 0x0206, 0x0209, 0x0301, 0x0304, 0x0308, 0x030A,
  // 17 st-17 Silverhoard Mine (craft) - 10 clips  1:{2,5,8,10} 2:{4,6,9} 3:{1,3,7}
  0x0102, 0x0105, 0x0108, 0x010A, 0x0204, 0x0206, 0x0209, 0x0301, 0x0303, 0x0307,
  // 18 st-18 Etzhyii Village Ruins (song) - 10 clips  1:{2,5,8} 2:{1,4,6,9,10} 3:{3,7}
  0x0102, 0x0105, 0x0108, 0x0201, 0x0204, 0x0206, 0x0209, 0x020A, 0x0303, 0x0307,
  // 19 st-19 Ranger Camp (base) - 10 clips  1:{1,2,3,4,5,6,7,8,9,10}
  0x0101, 0x0102, 0x0103, 0x0104, 0x0105, 0x0106, 0x0107, 0x0108, 0x0109, 0x010A,
  // 20 st-20 Hearer's Hollow (base) - 10 clips  2:{1,2,3,4,5,6,7,8,9,10}
  0x0201, 0x0202, 0x0203, 0x0204, 0x0205, 0x0206, 0x0207, 0x0208, 0x0209, 0x020A,
  // 21 st-21 ElmRoot (base) - 10 clips  3:{1,2,3,4,5,6,7,8,9,10}
  0x0301, 0x0302, 0x0303, 0x0304, 0x0305, 0x0306, 0x0307, 0x0308, 0x0309, 0x030A,
};

/**
 * One more entry than there are places: the run for station N ends at
 * QL_CLIP_INDEX[N + 1], so station QL_CLIP_STATION_MAX needs an index after it.
 * Index 0 is the hub, which has no card.
 */
static const uint16_t QL_CLIP_INDEX[QL_CLIP_STATION_MAX + 2] = {
  0, 0, 10, 20, 31, 41, 51, 61, 71, 80, 90, 100,
  110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 210,
  210,
};
