import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router'
import AppShell from './components/AppShell.jsx'
import Landing from './routes/Landing.jsx'
import Timetable from './routes/Timetable.jsx'
import Datesheet from './routes/Datesheet.jsx'
import { LoadingScreen, Screen } from './components/States.jsx'

// The admin area pulls in SheetJS for parsing; keep it out of the student bundle.
const Admin = lazy(() => import('./routes/Admin.jsx'))

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Landing />} />
        <Route path="timetable" element={<Timetable />} />
        <Route path="datesheet" element={<Datesheet />} />
        <Route
          path="admin/*"
          element={
            <Suspense fallback={<LoadingScreen what="admin" />}>
              <Admin />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={<Screen glyph="◱" title="Page not found">That link does not lead anywhere.</Screen>}
        />
      </Route>
    </Routes>
  )
}
