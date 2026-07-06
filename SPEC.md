Tribe App Spec
Build the smallest useful version of Tribe: a collaborative group travel planning workspace that helps organizers pitch, plan, and coordinate trips from idea to departure. Build P0 first. Do not build out-of-scope features unless explicitly approved.

0. Product Thesis
App name: Tribe
Primary user: Group trip organizers, starting with Pride/LGBTQ+ travelers organizing trips for friends and chosen family.
Category: Collaborative group travel planning platform.
Pain/problem: Group trip planning is fragmented across group chats, docs, spreadsheets, calendars, payment apps, booking sites, emails, and saved social posts. Organizers struggle to coordinate people, decisions, itineraries, expenses, and logistics in one place.
Current workaround: iMessage, WhatsApp, Messenger, Google Docs, Google Sheets, shared notes, calendar invites, Venmo, booking websites, email, saved Instagram/TikTok posts.
MLP promise: In the first version, a user can pitch a group trip, invite their crew, organize flights, stays, activities, costs, and itineraries, and track planning progress in one shared place.
Core differentiator: Trip Pitch + Planning Readiness + one shared workspace.
Success looks like in first 30 days:
10 active trips created.
40 participants join trips.
60% of trips reach at least 60% planning readiness.
60% of organizers create a second trip.
1. One-Liner
Tagline: Pitch. Plan. Go.
Elevator pitch: Planning a group trip should not require juggling group chats, spreadsheets, notes, calendars, and payment apps. Tribe gives organizers one place to pitch a trip, invite their crew, coordinate logistics, and track progress from idea to departure. Tribe launches with Pride and LGBTQ+ group travel before expanding to every type of group adventure.
Positioning: Tribe is not just a trip planner, not a generic social planning app, and not primarily a community app. It is a collaborative coordination platform for group travel.
2. Tech Defaults
Build path: Developer-built web app using AI-assisted development tools like Codex/GitHub, with Lovable used only where appropriate.
First launch platform: Responsive web app.
Frontend: React. Expo/web can be considered if it improves future mobile portability.
Backend: Supabase.
Database: Postgres via Supabase.
Auth: Supabase Auth.
Auth methods for MLP: Email/password, Google, Apple.
Storage: Supabase Storage for files, images, confirmations, and attachments.
Payments: None in beta. Stripe later for organizer-paid per-trip pricing.
Email: Resend, Postmark, or Supabase-compatible provider.
Analytics: PostHog or similar.
Error monitoring: Sentry or similar.
Mobile plan: Responsive web first; PWA later if useful; native mobile later only after validation.
Non-negotiable stack choices:
Must support private trips and invite-only access.
Must enforce permissions server-side.
Must support organizer/co-organizer/member roles per trip.
Must keep data model flexible enough for future trip templates, payments, and mobile.
Flexible stack choices:
Exact frontend framework details.
Exact analytics/email/error tooling.
Whether to structure as pure React web or Expo-compatible web.
3. Users, Roles, And Access
Role	Who they are	Can do	Cannot do	Priority
anon	Not signed in	Preview an invited Trip Pitch before creating an account	Access private workspace details	P0
member	Signed-in standard user	Join trips, RSVP, vote, comment, complete tasks, view itinerary	Manage trip settings unless organizer/co-organizer	P0
organizer	Trip creator/owner	Full control over trip, settings, permissions, lifecycle, official itinerary	Process payments in MLP	P0
co_organizer	Trusted helper appointed by organizer	Help manage itinerary, approvals, votes, tasks, expenses, participants	Delete/archive trip unless allowed by organizer	P0
admin	Internal TGK Labs role	Support, moderation, feature flags, platform administration	Participate as a trip member unless invited separately	P1

Account model: Individual users can belong to multiple trips and hold different roles across different trips.
Sign-up flow: Invite-only beta.
Trip privacy: Private by default. Only invited members can access a trip workspace.
Public discovery: Out of scope for MLP.
Invite methods: Shareable invite link, email invitation, QR code generated from invite link.
Future invite methods: Trip codes later, not MLP.
Invite preview: Invitees can preview Trip Pitch details before account creation, then join by creating an account.
Invite Preview Rules
Invitees may see:
Destination.
Dates or TBD.
Hero image/photos.
Organizer.
Who is going, if organizer allows.
Trip description.
Trip vibe/tags.
Join Trip CTA.
Invitees may not see before joining:
Private Chatter.
Expenses.
Personal travel details.
Files/attachments unless explicitly public to invite preview.
Participant tasks.
Permission Matrix
Entity / action	anon	member	organizer	co_organizer	admin
Trip Pitch preview	invite only	yes	yes	yes	operational
Trip workspace read	none	member trips	owned trips	assigned trips	operational
Trip settings update	none	none	yes	limited	support
Official itinerary edit	none	none	yes	yes	support
Suggestions create	none	yes	yes	yes	no
Suggestions approve	none	none	yes	yes	no
Vote participate	none	yes	yes	yes	no
Vote create/manage	none	limited/no	yes	yes	no
Expense create	none	yes, if allowed	yes	yes	no
Expense settle status	none	own/payment-related	yes	yes	no
Chatter comment	none	yes	yes	yes	moderation
Task assign	none	none	yes	yes	no
Task complete	none	own tasks	yes	yes	no
Files upload	none	yes, if allowed	yes	yes	moderation

4. Core Entities
users
Priority: P0
Purpose: Represents a signed-in person.
Owned by: User.
Field	Type	Required?	Notes
id	unique id	yes	primary identifier
email	string	yes	unique
display_name	string	yes	preferred name
avatar_url	string	no	later optional
created_at	datetime	yes	creation timestamp

Profile fields for travel: Preferred name, pronouns optional, home city, home airport, dietary restrictions, accessibility needs, roommate preferences, emergency contact optional.
Avoid in MLP: Legal name.
trips
Priority: P0
Purpose: The central travel workspace.
Owned by: Organizer.
Field	Type	Required?	Notes
id	unique id	yes	primary identifier
organizer_id	user id	yes	creator
title	string	yes	e.g. Palm Springs Pride
destination	string	no	may be TBD
date_start	date	no	may be TBD
date_end	date	no	may be TBD
estimated_budget	number	no	may be TBD
description	text	no	why we are going
organizer_note	text	no	personal note
hero_image_url	string	no	pitch image
status	enum	yes	draft, pitched, planning, active, completed, archived
visibility	enum	yes	private
created_at	datetime	yes	creation timestamp

Lifecycle: draft -> pitched -> planning -> active -> completed -> archived.
Completion rule: Trips may automatically close after trip end when outstanding balances/tasks are resolved.
trip_members
Priority: P0
Purpose: Links users to trips with a role and RSVP status.
Field	Type	Required?	Notes
id	unique id	yes	primary identifier
trip_id	trip id	yes	related trip
user_id	user id	yes	related user
role	enum	yes	organizer, co_organizer, member
rsvp_status	enum	yes	interested, maybe, committed, cant_make_it
joined_at	datetime	no	set when joined

trip_invites
Priority: P0
Purpose: Allows invite links, email invites, and QR codes.
Field	Type	Required?	Notes
id	unique id	yes	primary identifier
trip_id	trip id	yes	related trip
token	string	yes	secure invite token
email	string	no	for email invite
created_by_user_id	user id	yes	organizer/co-organizer
expires_at	datetime	no	optional
status	enum	yes	active, used, revoked, expired

trip_votes
Priority: P0
Purpose: Supports collaborative decisions.
Field	Type	Required?	Notes
id	unique id	yes	primary identifier
trip_id	trip id	yes	related trip
title	string	yes	e.g. Pick lodging
category	enum	yes	destination, dates, lodging, activities, budget, restaurants, transportation, other
open_at	datetime	no	voting open date
close_at	datetime	no	deadline
status	enum	yes	draft, open, closed, finalized
winning_option_id	id	no	set after close/finalize

vote_options and vote_responses
Priority: P0
Purpose: Stores options and member responses.
Rules: Members vote; organizer/co-organizer can finalize winning option.
itinerary_items
Priority: P0
Purpose: Official master schedule.
Field	Type	Required?	Notes
id	unique id	yes	primary identifier
trip_id	trip id	yes	related trip
title	string	yes	itinerary title
date	date	yes	item date
start_time	time	no	start
end_time	time	no	end
location_name	string	no	venue/location
address	string	no	map search
google_maps_url	string	no	simple map link
apple_maps_url	string	no	mobile map link
notes	text	no	details
cost	number	no	estimated/known
related_activity_id	id	no	optional relation

Edit access: Organizer/co-organizer only.
activities
Priority: P0
Purpose: Suggested or planned activities.
Fields: title, description, date/time optional, location, cost, RSVP/vote settings.
Activity RSVP values: interested, going, cant_make_it.
Rules: Members can suggest activities. Organizer/co-organizer can approve into official plan.
stays
Priority: P0
Purpose: Lodging options and selected accommodations.
Fields: name, type, address, check-in/out, cost, booking link, status, notes.
Roommate assignment: Support assigned room, assigned bed, roommate(s) in MLP.
travel_details
Priority: P0
Purpose: Manual participant travel details.
Fields: member_id, mode, arrival date/time, departure date/time, airline/train/car notes, confirmation optional, shared visibility.
Importing: Out of scope for MLP.
expenses
Priority: P0
Purpose: Ledger for shared and individual trip costs.
Field	Type	Required?	Notes
id	unique id	yes	primary identifier
trip_id	trip id	yes	related trip
title	string	yes	expense title
category	enum	yes	lodging, flights, activities, food_drink, transportation, shared_supplies, tickets, other
amount	number	yes	total amount
paid_by_user_id	user id	no	who paid upfront
split_method	enum	yes	even, selected_participants, custom_amounts
status	enum	yes	outstanding, paid

Payments: Track only. No payment processing in MLP.
tasks
Priority: P0
Purpose: Assign work and drive planning readiness.
Examples: Book your flight, upload arrival info, vote on lodging, pay organizer, RSVP, bring decorations.
Fields: title, description, assigned_to, due_date, status, related entity, created_by.
chatter_threads and comments
Priority: P0
Purpose: Lightweight trip-specific communication.
Scope: Trip-wide Chatter and context-specific comments on activity, expense, lodging, vote, itinerary item.
Features: Comments, @mentions, notifications.
Non-goal: Do not become WhatsApp or Discord.
files
Priority: P0
Purpose: Trip resource hub for files and links.
Examples: Booking confirmations, PDFs, tickets, packing list, Airbnb links, Google Maps links, TikToks, Instagram posts, restaurant links, flight search links, event pages.
feedback_submissions
Priority: P0
Purpose: Beta feedback collection.
Types: Bug report, feature request, general feedback, love this, confusing, contact me.
5. Routes, Screens, And Navigation
Public
Route/screen	Purpose	Priority	Notes
/	Landing page	P0	Pitch. Plan. Go.
/auth	Sign in/sign up	P0	email/password, Google, Apple
/privacy	Privacy policy	P0	final before beta
/terms	Terms	P0	final before beta
/invite/:token	Trip Pitch invite preview	P0	limited preview before account

Authenticated
Route/screen	Purpose	Priority
/app	User trip dashboard	P0
/app/trips/new	Create Trip Pitch	P0
/app/trips/:id	Trip Overview	P0
/app/trips/:id/pitch	Trip Pitch	P0
/app/trips/:id/people	People/RSVPs	P0
/app/trips/:id/itinerary	Itinerary	P0
/app/trips/:id/travel	Travel details	P0
/app/trips/:id/stays	Stays/lodging	P0
/app/trips/:id/activities	Activities	P0
/app/trips/:id/expenses	Expenses ledger	P0
/app/trips/:id/decisions	Votes/decisions	P0
/app/trips/:id/chatter	Trip Chatter	P0
/app/trips/:id/files	Files and links	P0
/app/trips/:id/settings	Trip settings	P0
/app/settings	User settings	P1

Admin
Route/screen	Purpose	Priority
/admin	Admin console	P1
/admin/users	Users	P1
/admin/trips	Trips and active trips	P1
/admin/feedback	Feedback submissions	P0
/admin/reports	Reported content	P1
/admin/flags	Feature flags	P1
/admin/analytics	Basic analytics/readiness metrics	P1

6. Trip Workspace Sections
The trip workspace should include:
Overview
Pitch
People
Itinerary
Travel
Stays
Activities
Expenses
Decisions
Chatter
Files
Settings
Navigation note: Travel appears before Stays because that matches how many groups think through planning. Files includes links.
7. Key Flows
Flow: Create Trip Pitch And Invite Crew
Priority: P0
Primary actor: Organizer.
Steps:
Organizer creates a trip with title, hero image, destination or TBD, dates or TBD, estimated budget or TBD, description, organizer note, and vibe/tags.
Trip enters draft or pitched status.
Organizer shares invite link/email/QR code.
Invitee previews pitch before creating account.
Invitee joins and selects RSVP/interest status.
Success state: Trip has at least one participant beyond organizer and visible interest/commitment.
Acceptance criteria: Given an invite link, an anonymous user can preview limited pitch details, create an account, join the trip, and appear in People.
Flow: Collaborative Planning And Readiness
Priority: P0
Primary actor: Organizer, co-organizer, members.
Steps:
Organizer creates votes for key decisions.
Members vote and suggest activities, lodging, restaurants, travel options, files, and links.
Organizer/co-organizer finalizes decisions and updates official itinerary.
Organizer assigns tasks to participants.
Planning Readiness updates as milestones complete.
Success state: Trip workspace becomes the shared source of truth and readiness increases.
Acceptance criteria: Given a trip with incomplete planning, completing decisions/tasks/itinerary/expenses increases readiness score.
Flow: Build Official Itinerary
Priority: P0
Primary actor: Organizer/co-organizer.
Steps:
Organizer adds time-blocked itinerary items.
Items include date, start/end time, location, notes, cost, related activity, attachments, comments.
Members view the master schedule.
Members can comment but cannot directly edit official itinerary.
Success state: Participants have one clear schedule.
Flow: Track Expenses Without Processing Payments
Priority: P0
Primary actor: Organizer/co-organizer/member.
Steps:
User adds an expense.
User selects category and split method.
App calculates balances.
Members settle externally.
Organizer/member marks paid manually.
Success state: Everyone can see outstanding vs paid balances.
Non-goal: Tribe does not move money in MLP.
Flow: Chatter In Context
Priority: P0
Primary actor: Trip member.
Steps:
Member posts in trip-wide Chatter or comments on a specific activity, expense, lodging option, vote, or itinerary item.
Mentions notify relevant members.
Context-specific comments stay attached to the planning item.
Success state: Trip discussion is easier to follow than one long group chat.
8. Planning Readiness
Priority: P0
Purpose: Tribe's signature progress indicator answering: "How ready are we to go?"
Planning Readiness should measure:
Destination selected.
Dates finalized.
Minimum participant threshold reached.
Lodging selected.
Flights/travel entered or marked not required.
Activities added.
Budget estimated.
Shared expenses entered.
Votes completed.
Participant tasks completed.
Calculation: Automatic by default.
Manual adjustment: Organizers can mark milestones complete/not applicable when appropriate, such as no flights needed for a local road trip.
Display: Prominent progress meter on trip Overview and organizer dashboard.
9. Trip Pitch
Priority: P0
Purpose: A defining feature and the origin story of the trip.
Trip Pitch includes:
Hero image.
Trip title.
Destination.
Date or TBD.
Estimated budget or TBD.
Trip description / why we are going.
Organizer note.
Trip vibe/tags, such as Relaxing, Pride, Adventure, Foodie, Beach, Ski.
Interest meter.
RSVP/interest buttons.
Invite friends CTA.
RSVP/interest options:
Interested.
Maybe.
Committed.
Can't Make It.
Lifecycle: Pitch remains viewable after trip moves into Planning.
10. Monetization
Model: Free beta. Later freemium with organizer-paid per-trip pricing.
Payments in MLP: No.
Provider later: Stripe.
Participants: Should almost never have to pay.
Free
Create account.
Join unlimited trips.
Participate in trips.
Vote.
Comment.
View itineraries.
Basic planning.
Paid Later
Organizer-only features:
Larger trips.
Multiple active paid trips.
Advanced organizer analytics.
Exportable itineraries.
Enhanced expense management.
Premium templates.
Trip archives.
Organizer productivity tools.
Planned Pricing
Up to 5 members: Free.
6-10 members: $4.99/trip.
11-20 members: $9.99/trip.
21+ members: $19.99/trip.
11. Notifications And Email
Channels: In-app and email.
Initial Notification Events
Invite received.
Invite accepted.
Vote created.
Vote closing soon.
Vote completed.
Task assigned.
Task completed.
Itinerary updated.
Expense added.
Payment marked paid.
Mentioned in Chatter.
Organizer announcement.
In-app notifications: Daily usage, activity feed, mentions, updates.
Email notifications: Invitations, important reminders, upcoming trips, beta announcements.
From address: hello@<tribe-domain>.
Domain auth: SPF/DKIM/DMARC before email launch.
12. Integrations
Service	Purpose	Required for MLP?	Notes
Supabase	auth, database, storage	yes	core backend
Email provider	transactional email	yes	invites and reminders
PostHog or equivalent	analytics	recommended	product metrics
Sentry or equivalent	errors	recommended	production debugging
Google Maps / Apple Maps links	location links	optional	simple links only, no embedded maps required
Stripe	payments	no	after beta

13. Analytics And Measurement
North star metric: Active trips reaching meaningful Planning Readiness.
Activation event: Organizer creates Trip Pitch, invites members, and at least one member joins/responds.
Retention metric: Organizer creates a second trip.
Beta success metrics: See Product Thesis.
Events To Track
Event name	Trigger	Priority
signed_up	user creates account	P0
trip_created	organizer creates trip	P0
trip_pitched	trip status becomes pitched	P0
invite_sent	invite created/sent	P0
invite_previewed	anon views invite preview	P0
trip_joined	invitee joins	P0
rsvp_updated	member changes interest/commitment	P0
vote_created	organizer creates vote	P0
vote_completed	vote closes/finalizes	P0
itinerary_item_added	official itinerary updated	P0
expense_added	expense created	P0
payment_marked_paid	payment status updated	P0
task_assigned	organizer assigns task	P0
task_completed	member completes task	P0
readiness_changed	readiness score updates	P0
feedback_submitted	beta feedback sent	P0

14. Design Direction
Visual mood: Organized, welcoming, adventurous.
Design balance: Travel/editorial 60% + productivity 40%.
Reference inspirations:
Airbnb for warmth, photography, destination inspiration.
Notion for information architecture.
Linear for clean workflows and interactions.
Partiful for invitations and event personality.
TripIt for itinerary presentation.
Avoid:
Corporate enterprise blues.
Heavy gray dashboards.
Neon rainbow overload.
Generic vacation brochure aesthetics.
Skeuomorphic travel graphics.
Design principle: Tribe should feel premium and useful, not touristy. It is a planning product that should make people excited to travel.
Brand phrases:
Pitch. Plan. Go.
One place for your tribe.
From idea to departure.
Travel better together.
Your trip. Finally organized.
Less planning chaos. More travel.
Everything your group needs. One workspace.
Plan together. Travel together.
15. Admin And Beta Feedback
Admin Console
Priority: P1 overall, but feedback review is P0 during beta.
Admin should include:
Users.
Trips.
Active trips.
Planning Readiness metrics.
Feedback submissions.
Feature flags.
Reported content.
Basic analytics.
Feedback Form
Priority: P0
Feedback types:
Bug Report.
Feature Request.
General Feedback.
Love This.
Confusing.
Contact me.
16. Safety, Inclusivity, And Trip Notes
Priority: P0 as informational fields, not a standalone feature.
Organizers should be able to add:
LGBTQ+-friendly neighborhoods.
Accessibility information.
Safety considerations.
Local travel tips.
Group-specific guidance.
Launch audience note: Pride/LGBTQ+ travelers are the first audience, but MLP should not hardcode LGBTQ+-specific trip templates. The product remains broadly applicable to friend groups, family vacations, reunions, destination weddings, chosen family getaways, Pride weekends, and group adventures.
Age restriction: No platform-wide age restriction. Individual trips can specify requirements such as 18+ or 21+.
17. Out Of Scope For MLP
Booking flights.
Booking hotels.
Booking activities.
In-app payments.
Payment processing.
Refund management.
Public trips.
Public discovery.
Social feeds.
Finding groups.
User profiles for discovery.
AI itinerary generation.
AI trip recommendations.
AI budgeting.
AI chat assistant.
Offline mode.
Version history.
Granular permissions beyond organizer, co-organizer, and member.
Real-time collaborative editing.
Native mobile app.
Complex embedded maps.
Airline import.
Confirmation parsing.
Calendar sync.
18. Build Phases
Phase 1: MLP Beta
Goal: Validate that organizers can pitch, coordinate, and progress group trips in one shared workspace.
Includes:
Auth with email/password, Google, Apple.
Invite-only beta.
Trip Pitch.
Invite preview and join flow.
Private trip workspace.
Overview, Pitch, People, Itinerary, Travel, Stays, Activities, Expenses, Decisions, Chatter, Files, Settings.
Planning Readiness.
RSVP/interest.
Suggestions and organizer approval.
Votes with deadlines.
Tasks.
Lightweight Chatter and item comments.
Expense ledger with manual paid/unpaid status.
Files/links hub.
Notifications.
Feedback form.
Phase 2: Monetization And Power Organizer Tools
Includes:
Stripe payments.
Organizer-paid per-trip pricing.
Larger trips.
Exportable itineraries.
Enhanced expense management.
Premium templates.
Trip archives.
Organizer analytics.
Phase 3: Expansion
Includes:
Public/discoverable trips if validated.
Mobile app/PWA improvements.
AI assistive features if truly useful.
Calendar sync.
Travel confirmation parsing.
More advanced collaboration.
19. Launch Checklist
Product

Organizer can create Trip Pitch with TBD fields.

Invitee can preview pitch before account creation.

Invitee can create account and join trip.

Member can set RSVP/interest.

Organizer/co-organizer can manage official itinerary.

Members can suggest items without editing official itinerary.

Votes work with deadlines and finalized winner.

Planning Readiness updates automatically.

Organizer can manually mark readiness milestone not applicable.

Tasks can be assigned and completed.

Expenses split correctly and can be marked paid/unpaid.

Chatter works globally and on context-specific items.

Files/links can be added.

Feedback form works.
Data And Permissions

Private trips are visible only to members.

Invite preview exposes only approved pitch fields.

Organizer/co-organizer/member permissions are enforced server-side.

Participants cannot edit official itinerary unless promoted.

Payment tracking does not process actual money.
Notifications

Invite received.

Invite accepted.

Vote created/closing/completed.

Task assigned/completed.

Itinerary updated.

Expense added.

Payment marked paid.

Mentioned in Chatter.
Trust And Launch

Privacy policy final.

Terms final.

Email domain authentication configured.

Error monitoring enabled or intentionally deferred.

Analytics events fire without collecting unnecessary sensitive data.

One real organizer completes the core flow with a real group.
20. Open Questions
Final domain name.
Final brand color palette.
Exact initial beta group size.
Whether Expo/web or standard React is the better first build.
Whether all file uploads are allowed in beta or only links/limited attachments.
Whether organizers can allow/hide "who's going" on invite preview.
Exact weighting formula for Planning Readiness.
21. Builder Instructions
Build principle: Ship the smallest version that makes group trip planning feel organized, collaborative, and real.
Decision rule: If a missing detail does not affect P0 behavior, choose the simplest conventional option and document the assumption.
Ask first when: the missing detail affects permissions, trip privacy, invite preview visibility, expense balances, notifications, or Planning Readiness formula.
Do not build: anything listed in "Out Of Scope For MLP" unless explicitly approved.
Before final delivery: verify the core organizer flow, invite flow, permissions, readiness scoring, and beta feedback loop.
