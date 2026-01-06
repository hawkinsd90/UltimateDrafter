import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import PhoneVerificationGate from './components/PhoneVerificationGate';
import Home from './pages/Home';
import Login from './pages/Login';
import LeagueList from './pages/LeagueList';
import LeagueDetail from './pages/LeagueDetail';
import CreateLeague from './pages/CreateLeague';
import DraftList from './pages/DraftList';
import CreateDraft from './pages/CreateDraft';
import ManageParticipants from './pages/ManageParticipants';
import DraftBoard from './pages/DraftBoard';
import NotificationSettings from './pages/NotificationSettings';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PhoneVerificationGate>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/leagues" element={<ProtectedRoute><LeagueList /></ProtectedRoute>} />
            <Route path="/leagues/create" element={<ProtectedRoute><CreateLeague /></ProtectedRoute>} />
            <Route path="/leagues/:leagueId" element={<ProtectedRoute><LeagueDetail /></ProtectedRoute>} />
            <Route path="/leagues/:leagueId/drafts" element={<ProtectedRoute><DraftList /></ProtectedRoute>} />
            <Route path="/leagues/:leagueId/drafts/create" element={<ProtectedRoute><CreateDraft /></ProtectedRoute>} />
            <Route path="/drafts/:draftId" element={<ProtectedRoute><DraftBoard /></ProtectedRoute>} />
            <Route path="/drafts/:draftId/participants" element={<ProtectedRoute><ManageParticipants /></ProtectedRoute>} />
            <Route path="/settings/notifications" element={<ProtectedRoute><NotificationSettings /></ProtectedRoute>} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
          </Routes>
        </PhoneVerificationGate>
      </AuthProvider>
    </BrowserRouter>
  );
}
