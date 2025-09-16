# Fit Coach — Product Vision

## Overview
Fit Coach is an AI-powered fitness coach that helps users train effectively, explore their fitness goals, and adapt their workouts to their lifestyle. The system collects essential data, builds personalized workout plans, adapts them dynamically, and provides continuous support and motivation.

---

## Registration: Quick Setup (Required Minimum)
At the first interaction, the user completes a quick setup to provide the absolute must-have data for personalized training:

- **Goals**: primary fitness goal such as weight loss, muscle gain, body toning, endurance, or general health.  
- **Sex**  
- **Date of birth**  
- **Height**  
- **Weight**  
- **Fitness level** (self-assessed with criteria):  
  - Beginner: less than 3 months of consistent training  
  - Intermediate: 3 to 12 months of consistent training  
  - Advanced: more than 1 year of consistent training  
- **Key health restrictions**: current or past injuries, chronic conditions, medical contraindications  
- **Preferred training location**: home, gym, outdoors  
- **Available equipment**: dumbbells, resistance bands, treadmill, mat, etc.  
- **Available training time**: days per week, preferred times, duration per session, total hours per week  

---

## Onboarding: Extended (Required for Plan, Gradual)
After the quick setup, users provide additional context so the coach can build a safe and relevant training plan. Users may lean on curated defaults, but every plan-critical input must be confirmed.

Onboarding begins immediately after registration confirmation; once plan prerequisites are satisfied (answers or confirmed defaults), the system hands off to planning (profileStatus='planning').

### Anthropometry
- Body measurements (waist, hips, chest, arms, legs)  
- Body fat percentage (if known)  

### Baseline Activity
- Typical daily activity level with step-based categories:  
  - Sedentary: less than 5000 steps/day  
  - Lightly active: 5000–8000 steps/day  
  - Active: more than 8000 steps/day  
- Usual step count or activity tracker data (if available)  
- Types of activities regularly performed (walking, cycling, etc.)  

### Goals
- Secondary goals (flexibility, stress relief, improved sleep)  
- Target milestones or events (5k run, wedding, vacation)  
- Desired timeline for achieving goals  

### Fitness Level Details
- Previous training experience (gym, home workouts, sports)  
- Familiarity with specific exercises or equipment  
- Recent workout consistency and frequency  

### Health and Restrictions
- Areas of pain or discomfort  
- Physician recommendations or restrictions  
- Allergies or sensitivities affecting training or nutrition  

### Training Environment
- Space available for exercise  
- Access to special facilities (pool, park, sports courts)  
- Restrictions on noise or movement at home  

### Time and Schedule
- Schedule flexibility (fixed or variable)  

### Starting Indicators
- Recent fitness test results (push-ups, plank, 1-mile run)  
- Resting heart rate  
- Blood pressure (if available)  
- Recent body composition analysis  
- Photos or other baseline records for progress tracking  

### Preferences
- Preferred workout styles (HIIT, yoga, strength, cardio, pilates)  
- Enjoyed or disliked activities  
- Group vs. solo training preference  
- Desired level of coaching guidance (detailed vs. high-level)  
- Music or motivational preferences  

### Nutrition
- Usual eating habits and meal patterns  
- Dietary preferences (vegetarian, vegan, omnivore)  
- Food allergies or intolerances  
- Hydration habits  
- Interest in nutrition guidance or meal planning  
- Current nutrition challenges (snacking, portion control)  

---

## Ongoing Data Collection
More detailed data can be gathered progressively during workouts and user interactions. The system continually enriches the user profile through:

- Feedback on perceived difficulty, discomfort, and actual performance  
- Updates on health status or restrictions  
- Adjustments in goals or preferences  
- Behavioral patterns and adherence  

This ongoing data collection ensures the AI adapts dynamically and personalizes the experience over time.

---

## Workout Plan Generation (Separate Feature)
After onboarding confirms plan readiness, a dedicated plan-creation feature (post-onboarding) prepares and iterates on personalized workout plans. Registration/Onboarding ends once the user confirms the onboarding summary; plan approval happens in that follow-up feature. High-level flow (for reference):

1. Generate draft plan — exercises with sets, reps, safety notes, and rationale aligned with confirmed data.
2. Present summary — highlight structure (split, frequency, focus areas) and key considerations.
3. Capture feedback — the user may comment, suggest tweaks, or flag concerns (e.g., equipment, volume, preferences).
4. Iterate — the assistant asks follow-up questions or applies defaults to adjust the draft, then proposes an updated version.
5. Approve — once the user confirms the plan, training sessions become available and subsequent coaching features take over.

Plan approval is outside the scope of FEAT-0006/0007 and will be implemented in a dedicated feature.

---

## Training Sessions
- The UI always reflects one of two states:
  - Active session in progress (exactly one per user)
  - No active session → offer to start the next workout
- The AI acknowledges that users may skip sessions or train more or less frequently than planned  
- Users can ask at any time: *“What should I do today?”* → the AI builds a session considering:  
  - Previous workouts and targeted muscle groups  
  - User feedback (pain, ease/difficulty, actual reps performed)  
  - Time since the last session  
- These ongoing interactions help enrich the user profile (ongoing data collection) and ensure balance between training and recovery  

---

## Adaptation and Flexibility
- Users can shorten or modify workouts as needed  
- The AI suggests alternatives based on available equipment and current conditions  
- Plans are continuously adapted to real behavior and progress  

---

## Motivation and Psychological Support (Planned Expansion)
Initial MVP will focus on workouts and adaptation. Psychological features such as motivation, challenges, and gamification will be expanded later.

---

## Analytics and Progress (Planned Expansion)
Charts, reports, and deeper analytics will be included in later versions. The MVP focuses on safe and adaptive training.

---

## Final Purpose
Fit Coach starts with a minimal viable onboarding to collect essential data, builds individualized plans, adapts dynamically based on real-time feedback, and progressively enriches user data and features to support long-term fitness success.
