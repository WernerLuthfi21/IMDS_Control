# Runtime ReferenceError: CalendarClock is not defined

## Cause

`app/page.tsx` rendered `CalendarClock` and `ArrowRight` in the Shortcuts area without importing those symbols from `lucide-react`.

## Fix in v0.2.1

The icon import now includes both symbols:

```tsx
import { ArrowRight, CalendarClock, FileUp, Inbox, ListChecks, RefreshCw, Users } from "lucide-react";
```

## If applying the fix manually to v0.2.0

1. Open `app/page.tsx`.
2. Find the import from `lucide-react`.
3. Replace it with the line above.
4. Stop the dev server with `Ctrl+C`.
5. Start again with `npm run dev`.
6. If the old error remains, remove the Next.js cache and restart:

PowerShell:

```powershell
Remove-Item .next -Recurse -Force -ErrorAction SilentlyContinue
npm run dev
```

This is a missing frontend symbol import. It is not a Supabase or database error.
