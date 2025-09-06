/**
 * User-facing messages and texts (English)
 * These are the actual texts shown to users, not code comments
 * Language will be determined by user profile in the future
 */

export const USER_MESSAGES = {
  // Welcome and greeting messages
  WELCOME: `Hello! I'm your personal AI fitness coach.

To create a personalized training program, I need to know a bit about you. This will take just a few minutes.

📋 Current Progress:
❌ Basic Information (age, gender, height, weight)
❌ Fitness Level
❌ Training Goals

Let's start with your basic information. Please tell me:
• How old are you?
• What is your gender (male/female)?
• What is your height (in cm)?
• What is your weight (in kg)?

You can answer all questions at once or one at a time.`,

  // Success messages
  BASIC_INFO_SUCCESS: (age: number, gender: string, height: number, weight: number) => 
    `Great! I've recorded your information:
• Age: ${age} years
• Gender: ${gender === 'male' ? 'male' : 'female'}
• Height: ${height} cm
• Weight: ${weight} kg

📋 Progress:
✅ Basic Information
❌ Fitness Level
❌ Training Goals

Now let's determine your fitness level. Which option best describes you:
• Beginner (never exercised regularly)?
• Intermediate (exercised 1-2 years)?
• Advanced (exercised more than 2 years regularly)?`,

  FITNESS_LEVEL_SUCCESS: (level: string) => `Great! Your level: ${getFitnessLevelNameEn(level)}

📋 Progress:
✅ Basic Information
✅ Fitness Level
❌ Training Goals

Final step - your goals. What do you want to achieve?
• Lose weight and burn fat
• Build muscle mass
• Maintain current fitness
• Improve overall health
• Increase strength and endurance`,

  GOALS_SUCCESS: (goal: string, profileData: any) => `Great! Your goal: ${getGoalNameEn(goal)}

📋 Progress:
✅ Basic Information
✅ Fitness Level
✅ Training Goals

Let's review all the information:

👤 Profile:
• Age: ${profileData.age ?? 'not specified'} years
• Gender: ${profileData.gender === 'male' ? 'male' : 'female'}
• Height: ${profileData.height ?? 'not specified'} cm
• Weight: ${profileData.weight ?? 'not specified'} kg
• Level: ${getFitnessLevelNameEn(profileData.fitnessLevel)}
• Goal: ${getGoalNameEn(profileData.fitnessGoal)}

Is everything correct? Reply with:
• "yes" - to confirm and complete registration
• "edit [field]" - to change a specific field (e.g., "edit age")`,

  REGISTRATION_COMPLETE: `Excellent! Registration completed! 🎉

I now know enough about you to create a personalized training program.
How can I help you today?`,

  // Error and clarification messages
  CLARIFICATION: (missingFields: string[]) => {
    const fieldNamesEn: Record<string, string> = {
      'age': 'age',
      'gender': 'gender',
      'height': 'height',
      'weight': 'weight',
      'fitnessLevel': 'fitness level',
      'fitnessGoal': 'training goals',
    };

    const readableFields = missingFields.map(field => fieldNamesEn[field] || field).join(', ');

    return `I couldn't recognize ${readableFields}.
Please specify ${readableFields} more clearly.

Examples:
• Age: "I am 28 years old" or "28"
• Height: "175 cm" or "5'9""
• Weight: "75 kg" or "165 lbs"`;
  },

  CONFIRMATION_NEEDED: `Please confirm the information by replying with:
• "yes" - to confirm and complete registration
• "edit [field]" - to change a specific field (e.g., "edit age")`,

  PROFILE_RESET: `Okay, let's correct the information.

Please tell me again:
• How old are you?
• What is your gender (male/female)?
• What is your height (in cm)?
• What is your weight (in kg)?`,

  // Questions
  FITNESS_LEVEL_QUESTION: `I couldn't determine your fitness level. Please specify more clearly:

• "beginner" - if you've never exercised regularly
• "intermediate" - if you've exercised for 1-2 years
• "advanced" - if you've exercised for more than 2 years regularly`,

  GOAL_QUESTION: `I couldn't determine your training goal. Please specify more clearly:

• "lose weight" - for weight loss
• "build muscle" - for muscle gain
• "maintain" - for maintaining current fitness
• "get healthy" - for overall health improvement`,

  // Status messages
  PROFILE_COMPLETE: 'Your profile is already complete! How can I help you?',

  // AI prompts for different registration steps
  AI_PROMPT_INCOMPLETE: 'User is starting registration. Greet them and begin collecting basic information.',
  AI_PROMPT_COLLECTING_BASIC: 'Collect basic information: age, gender, height, weight. Be patient and clear.',
  AI_PROMPT_COLLECTING_LEVEL: 'Determine user fitness level: beginner, intermediate, or advanced.',
  AI_PROMPT_COLLECTING_GOALS: 'Find out training goals: lose weight, build muscle, maintain fitness, etc.',
  AI_PROMPT_CONFIRMATION: 'Confirm all collected data and complete registration.',
  AI_PROMPT_COMPLETE: 'Registration completed, user is ready for training.',
} as const;

// Helper functions for translations
function getFitnessLevelNameEn(level?: string): string {
  switch (level) {
    case 'beginner': return 'Beginner';
    case 'intermediate': return 'Intermediate';
    case 'advanced': return 'Advanced';
    default: return 'Not determined';
  }
}

function getGoalNameEn(goal?: string): string {
  const goalNames: Record<string, string> = {
    'weight_loss': 'Lose weight',
    'muscle_gain': 'Build muscle',
    'maintain': 'Maintain fitness',
    'strength': 'Increase strength',
    'general_fitness': 'Improve health',
  };
  return goalNames[goal ?? ''] ?? 'Not determined';
}
