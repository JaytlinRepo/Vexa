# VEXA — Frontend Structure Guide
# All files in apps/web/src/

## app/layout.tsx
Root layout. Providers: QueryClient, Auth, Zustand.
Fonts: Syne + DM Sans from Google Fonts.
Global CSS variables matching design system.

## app/page.tsx  
Marketing homepage → redirect to /dashboard if authenticated.
Import and render the full marketing site (vexa-website.html converted to React).

## app/auth/login/page.tsx
Login form. Email + password.
AWS Cognito via Amplify Auth.
Link to signup. 
On success → redirect to /dashboard or /onboarding if no company set up.

## app/auth/signup/page.tsx
Signup form. Name, email, password.
Cognito user pool registration.
On success → redirect to /onboarding.

## app/auth/onboarding/page.tsx
Multi-step onboarding wizard. CRITICAL EXPERIENCE.
Step 1: "Name your company" — input for company/brand name
Step 2: "Choose your niche" — grid of niche cards (fitness, finance, food, etc.)
Step 3: "Get specific" — sub-niche text input ("women's strength training, no gym")
Step 4: "Your brand voice" — tone selector (motivational/educational/entertaining/inspiring) + avoid list
Step 5: "Your audience" — who they create for
Step 6: "Meet your team" — animated reveal of the 4 employees joining the company
         Each employee card slides in with their name, role, and a welcome message.
On complete → POST /api/onboarding/company → redirect to /dashboard

## app/dashboard/overview/page.tsx
CEO overview. Components:
- WelcomeHeader — "Good morning, [name]" + company name
- TeamStatusBar — 4 employee status pills
- ActiveTasksFeed — most recent delivered outputs awaiting action
- QuickStats — posts approved this week, tasks completed, etc.

## app/dashboard/team/page.tsx
Employee cards grid (2x2).
Each EmployeeCard shows:
- Avatar, name, role title
- Current status (idle / working / output ready)
- Last delivery summary
- "View Work" button → opens output
- "Assign Task" button → task assignment modal
- "Call a Meeting" button → opens MeetingRoom

## app/dashboard/strategy/page.tsx
Jordan's content calendar view.
Weekly grid showing all planned posts.
Each post cell: format icon, topic, angle.
Approve/reject entire plan or individual days.

## app/dashboard/trends/page.tsx
Maya's trend dashboard.
List of TrendReportCards from latest report.
Each card: topic, growth %, why it matters, suggested hook, action buttons.
"Refresh trends" button → POST /api/trends/refresh

## app/dashboard/tasks/page.tsx
All tasks with status filters.
Tabs: Delivered (action needed) / In Progress / Completed / Rejected
Each TaskRow: employee avatar, task title, type badge, status, action button.

## app/dashboard/outputs/page.tsx
Outputs library. Filter by: employee, content type, date, status.
OutputCard for each: content preview, employee tag, approve/reject status, export button.

## app/dashboard/settings/page.tsx
Tabs: Profile / Brand Voice / Niche / Subscription
Subscription tab: current plan, usage stats, "Manage billing" → Stripe portal.

---

## KEY COMPONENTS TO BUILD

### components/employees/EmployeeCard.tsx
Props: employee, status, currentTask, lastOutput, onAssignTask, onCallMeeting, onViewWork
Design: Dark card, colored top border per employee, avatar with emoji, status indicator dot.
Actions: Three buttons at bottom.

### components/meeting/MeetingRoom.tsx  
Full-screen modal overlay. Distinct visual — feels like a different space.
Header: Employee avatar (larger), name, role, "In a meeting" indicator.
Messages: Chat-style but styled as meeting transcript (not ChatGPT bubbles).
Employee messages: left-aligned, dark card, employee color accent.
User messages: right-aligned, subtle.
Input: Single text input at bottom (ONLY free-form input in the app).
Footer: "End Meeting" button — prominent, always visible.
On stream: Employee response types in real-time character by character.

### components/outputs/OutputCard.tsx
Polymorphic — renders differently based on OutputType.
TrendReport: Trend cards with growth badges.
ContentPlan: Mini calendar grid.
Hooks: Numbered hook cards, each with individual approve/use button.
Script: Section-by-section script viewer.
ShotList: Numbered shot cards with camera icons.
Video: Video player with thumbnail.
Footer: ActionButtonGroup with correct buttons per type.

### components/shared/ActionButtonGroup.tsx
Props: outputType, onAction, isLoading
Renders the correct button set from OUTPUT_ACTIONS config.
Approve: Green/accent colored.
Reject: Subtle, destructive.
Reconsider: Outlined, neutral.
If feedbackPrompt set on button: show inline text input before submitting.

### components/shared/EmployeeAvatar.tsx
Consistent employee avatar: emoji in rounded square, color background per employee.
Sizes: sm (32px), md (44px), lg (64px), xl (96px — for meeting room).

---

## ZUSTAND STORE STRUCTURE

### stores/company.store.ts
- currentCompany: Company | null
- employees: EmployeeWithStatus[]
- setCompany, setEmployees

### stores/tasks.store.ts  
- tasks: Task[]
- activeMeeting: Meeting | null
- setTasks, addTask, updateTask
- setActiveMeeting, clearMeeting

### stores/ui.store.ts
- isMeetingOpen: boolean
- meetingEmployeeId: string | null
- openMeeting(employeeId), closeMeeting

---

## API CLIENT (lib/api.ts)
Axios instance with:
- Base URL from env
- Auth interceptor: attach Cognito JWT to every request
- Response interceptor: handle 401 (redirect to login), 403 (plan upgrade prompt)

---

## DESIGN TOKENS (styles/globals.css)
--black: #080808
--off-black: #0f0f0f  
--card: #141414
--border: #222222
--border-light: #2a2a2a
--text: #f0ede8
--muted: #666
--accent: #c8f060        (primary action / approve)
--gold: #e8c87a          (stars / highlights)
--blue: #6ab4ff          (Maya's color)
--green: #c8f060         (Jordan's color)  
--purple: #b482ff        (Riley's color)
--reject-red: #ff6b6b    (reject actions)
