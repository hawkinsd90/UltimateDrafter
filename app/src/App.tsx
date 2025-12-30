import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import LeagueList from './pages/LeagueList';
import CreateLeague from './pages/CreateLeague';
import DraftList from './pages/DraftList';
import CreateDraft from './pages/CreateDraft';
import ManageParticipants from './pages/ManageParticipants';
import DraftBoard from './pages/DraftBoard';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/leagues" element={<LeagueList />} />
        <Route path="/leagues/create" element={<CreateLeague />} />
        <Route path="/leagues/:leagueId/drafts" element={<DraftList />} />
        <Route path="/leagues/:leagueId/drafts/create" element={<CreateDraft />} />
        <Route path="/leagues/:leagueId/drafts/:draftId/participants" element={<ManageParticipants />} />
        <Route path="/leagues/:leagueId/drafts/:draftId/board" element={<DraftBoard />} />
      </Routes>
    </BrowserRouter>
  );
}
