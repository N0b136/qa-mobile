import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import TopBar from './TopBar'
import BottomNav from './BottomNav'
import { currentUser } from '../services/authService'
import { syncBookingReminders } from '../services/bookingService'

export default function Shell() {
  const user = currentUser()

  useEffect(() => {
    if (user) syncBookingReminders(user.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  return (
    <>
      <TopBar />
      <Outlet />
      <BottomNav />
    </>
  )
}
