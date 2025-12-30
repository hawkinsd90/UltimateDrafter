# Draft Engine MVP - User Guide

## Overview

The DraftMaster MVP allows 2-4 teams to conduct a complete fantasy sports draft with automatic turn tracking and notification logging.

## Features Implemented

### 1. League Management
- Create leagues with sport and season
- View all leagues
- Navigate to league drafts

### 2. Draft Creation
- Create drafts within leagues
- Configure draft type (Snake or Linear)
- Set pick time limits
- Draft status tracking (setup → in_progress → completed)

### 3. Participant Management
- Add participants with team names
- Automatic draft position assignment
- Minimum 2 participants required to start
- View all participants in draft order

### 4. Live Draft Board
- Real-time display of current pick
- Highlight whose turn it is
- View all participants in order
- Complete pick history with player details

### 5. Player Selection
- Search players by name
- Filter out already-picked players
- View player position and team
- 30 sample players pre-loaded (football and basketball)

### 6. Snake Draft Logic
- Odd rounds: picks 1 → N
- Even rounds: picks N → 1
- Automatic turn advancement
- Correct pick numbering (overall, round, pick-in-round)

### 7. Notification Queue
- Insert notification into outbox on each pick
- Records next participant's turn
- Ready for Telnyx integration
- Stored in notifications_outbox table

## User Flow

1. **Create League**
   - Navigate to `/leagues/create`
   - Enter league name, sport, season
   - Submit to create

2. **Create Draft**
   - From league page, click "Create New Draft"
   - Enter draft name
   - Select type (Snake or Linear)
   - Set pick time (seconds)
   - Submit to create

3. **Add Participants**
   - From draft list, click "Setup Participants"
   - Add 2-4 team names
   - Click "Start Draft" when ready

4. **Conduct Draft**
   - Draft board shows current pick
   - Click "Make Pick" button
   - Search for player
   - Select player to make pick
   - Turn automatically advances
   - Notification logged in outbox

5. **View Progress**
   - Participants shown in draft order
   - Current turn highlighted
   - Complete pick history below
   - Each pick shows player details

## Technical Implementation

### Database Tables Used
- **leagues**: League metadata
- **drafts**: Draft sessions with current state
- **draft_participants**: Teams in draft with positions
- **players**: Provider-agnostic player database
- **draft_picks**: Complete pick history
- **notifications_outbox**: Notification queue

### Key Components
- `/app/src/pages/Home.tsx` - Landing page
- `/app/src/pages/LeagueList.tsx` - View all leagues
- `/app/src/pages/CreateLeague.tsx` - Create new league
- `/app/src/pages/DraftList.tsx` - View drafts in league
- `/app/src/pages/CreateDraft.tsx` - Create new draft
- `/app/src/pages/ManageParticipants.tsx` - Add participants
- `/app/src/pages/DraftBoard.tsx` - Live draft interface
- `/app/src/components/PlayerSearch.tsx` - Player selection modal

### Snake Draft Algorithm
```typescript
function getNextParticipant(currentPickNumber: number): Participant | null {
  const nextPickNumber = currentPickNumber + 1;
  const nextRound = Math.ceil(nextPickNumber / participants.length);
  const isNextRoundOdd = nextRound % 2 === 1;

  if (draft?.draft_type === 'snake') {
    if (isNextRoundOdd) {
      // Odd rounds: forward order (1 → N)
      const position = ((nextPickNumber - 1) % participants.length);
      return participants[position];
    } else {
      // Even rounds: reverse order (N → 1)
      const position = participants.length - 1 - ((nextPickNumber - 1) % participants.length);
      return participants[position];
    }
  } else {
    // Linear: always forward order
    const position = ((nextPickNumber - 1) % participants.length);
    return participants[position];
  }
}
```

### Pick Recording
Each pick stores:
- draft_id, participant_id, player_id
- pick_number (overall)
- round, pick_in_round
- picked_at timestamp
- time_taken_seconds
- is_autopick flag

### Notification Logging
On each pick:
```typescript
await supabase.from('notifications_outbox').insert({
  draft_id: draftId,
  participant_id: nextParticipant.id,
  notification_type: 'your_turn',
  channel: 'sms',
  recipient: nextParticipant.user_id,
  message: `${nextParticipant.team_name}, you are on the clock! Pick ${nextPickNumber}`,
  status: 'pending',
  metadata: { pick_number: nextPickNumber }
});
```

## Limitations (By Design)

- No authentication (temporary user IDs)
- No realtime subscriptions (manual refresh)
- No offline support
- No autopick functionality
- No trade or roster management
- Notifications logged but not sent

## Next Steps

1. Add authentication with Supabase Auth
2. Implement realtime subscriptions
3. Connect Telnyx for SMS notifications
4. Add autopick when time expires
5. Add draft chat/messaging
6. Add player rankings/ADP
7. Add draft history export
8. Add offline draft mode

## Testing

1. Visit `/` to start
2. Create a league
3. Create a draft
4. Add 2-4 participants
5. Start draft
6. Make picks and verify:
   - Turn advances correctly
   - Snake order works (if selected)
   - Players can't be picked twice
   - Notifications logged in database
   - Pick history displays correctly

## Database Queries for Verification

Check notifications:
```sql
SELECT * FROM notifications_outbox
WHERE draft_id = 'your-draft-id'
ORDER BY created_at DESC;
```

Check picks:
```sql
SELECT dp.pick_number, dp.round, dp.pick_in_round,
       pt.team_name, p.name as player_name
FROM draft_picks dp
JOIN draft_participants pt ON pt.id = dp.participant_id
JOIN players p ON p.id = dp.player_id
WHERE dp.draft_id = 'your-draft-id'
ORDER BY dp.pick_number;
```
