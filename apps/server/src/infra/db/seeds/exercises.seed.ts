import type { MuscleGroup } from '@domain/training/types';

import { db } from '@infra/db/drizzle';
import { exerciseMuscleGroups, exercises } from '@infra/db/schema';

import { createLogger } from '@shared/logger';

const log = createLogger('seed');

interface ExerciseSeed {
  name: string;
  category: 'compound' | 'isolation' | 'cardio' | 'functional' | 'mobility';
  equipment: 'barbell' | 'dumbbell' | 'bodyweight' | 'machine' | 'cable' | 'none';
  exerciseType: 'strength' | 'cardio_distance' | 'cardio_duration' | 'functional_reps' | 'isometric' | 'interval';
  description: string;
  energyCost: 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
  complexity: 'beginner' | 'intermediate' | 'advanced';
  typicalDurationMinutes: number;
  requiresSpotter: boolean;
  muscleGroups: Array<{
    muscle: MuscleGroup;
    involvement: 'primary' | 'secondary';
  }>;
}

const exerciseSeeds: ExerciseSeed[] = [
  // --- COMPOUND STRENGTH EXERCISES ---
  {
    name: 'Barbell Bench Press',
    category: 'compound',
    equipment: 'barbell',
    exerciseType: 'strength',
    description: 'Classic chest compound movement with barbell',
    energyCost: 'high',
    complexity: 'intermediate',
    typicalDurationMinutes: 12,
    requiresSpotter: true,
    muscleGroups: [
      { muscle: 'chest', involvement: 'primary' },
      { muscle: 'shoulders_front', involvement: 'secondary' },
      { muscle: 'triceps', involvement: 'secondary' },
    ],
  },
  {
    name: 'Barbell Back Squat',
    category: 'compound',
    equipment: 'barbell',
    exerciseType: 'strength',
    description: 'King of leg exercises, full lower body compound',
    energyCost: 'very_high',
    complexity: 'advanced',
    typicalDurationMinutes: 15,
    requiresSpotter: true,
    muscleGroups: [
      { muscle: 'quads', involvement: 'primary' },
      { muscle: 'glutes', involvement: 'primary' },
      { muscle: 'hamstrings', involvement: 'secondary' },
      { muscle: 'core', involvement: 'secondary' },
      { muscle: 'lower_back', involvement: 'secondary' },
    ],
  },
  {
    name: 'Conventional Deadlift',
    category: 'compound',
    equipment: 'barbell',
    exerciseType: 'strength',
    description: 'Full posterior chain compound movement',
    energyCost: 'very_high',
    complexity: 'advanced',
    typicalDurationMinutes: 12,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'back_lats', involvement: 'primary' },
      { muscle: 'back_traps', involvement: 'primary' },
      { muscle: 'glutes', involvement: 'primary' },
      { muscle: 'hamstrings', involvement: 'primary' },
      { muscle: 'lower_back', involvement: 'primary' },
      { muscle: 'forearms', involvement: 'secondary' },
      { muscle: 'core', involvement: 'secondary' },
    ],
  },
  {
    name: 'Barbell Overhead Press',
    category: 'compound',
    equipment: 'barbell',
    exerciseType: 'strength',
    description: 'Standing shoulder press, full upper body stability',
    energyCost: 'high',
    complexity: 'intermediate',
    typicalDurationMinutes: 10,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'shoulders_front', involvement: 'primary' },
      { muscle: 'shoulders_side', involvement: 'secondary' },
      { muscle: 'triceps', involvement: 'secondary' },
      { muscle: 'core', involvement: 'secondary' },
    ],
  },
  {
    name: 'Barbell Row',
    category: 'compound',
    equipment: 'barbell',
    exerciseType: 'strength',
    description: 'Bent-over row for back thickness',
    energyCost: 'high',
    complexity: 'intermediate',
    typicalDurationMinutes: 10,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'back_lats', involvement: 'primary' },
      { muscle: 'back_traps', involvement: 'primary' },
      { muscle: 'biceps', involvement: 'secondary' },
      { muscle: 'lower_back', involvement: 'secondary' },
      { muscle: 'core', involvement: 'secondary' },
    ],
  },
  {
    name: 'Pull-ups',
    category: 'compound',
    equipment: 'bodyweight',
    exerciseType: 'strength',
    description: 'Bodyweight back compound, vertical pull',
    energyCost: 'high',
    complexity: 'intermediate',
    typicalDurationMinutes: 8,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'back_lats', involvement: 'primary' },
      { muscle: 'biceps', involvement: 'secondary' },
      { muscle: 'forearms', involvement: 'secondary' },
      { muscle: 'core', involvement: 'secondary' },
    ],
  },
  {
    name: 'Dips',
    category: 'compound',
    equipment: 'bodyweight',
    exerciseType: 'strength',
    description: 'Bodyweight chest and triceps compound',
    energyCost: 'medium',
    complexity: 'intermediate',
    typicalDurationMinutes: 8,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'chest', involvement: 'primary' },
      { muscle: 'triceps', involvement: 'primary' },
      { muscle: 'shoulders_front', involvement: 'secondary' },
    ],
  },

  // --- ISOLATION STRENGTH EXERCISES ---
  {
    name: 'Dumbbell Bicep Curl',
    category: 'isolation',
    equipment: 'dumbbell',
    exerciseType: 'strength',
    description: 'Classic bicep isolation',
    energyCost: 'low',
    complexity: 'beginner',
    typicalDurationMinutes: 6,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'biceps', involvement: 'primary' },
      { muscle: 'forearms', involvement: 'secondary' },
    ],
  },
  {
    name: 'Tricep Pushdown',
    category: 'isolation',
    equipment: 'cable',
    exerciseType: 'strength',
    description: 'Cable tricep isolation',
    energyCost: 'low',
    complexity: 'beginner',
    typicalDurationMinutes: 6,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'triceps', involvement: 'primary' },
    ],
  },
  {
    name: 'Leg Extension',
    category: 'isolation',
    equipment: 'machine',
    exerciseType: 'strength',
    description: 'Quad isolation machine',
    energyCost: 'low',
    complexity: 'beginner',
    typicalDurationMinutes: 6,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'quads', involvement: 'primary' },
    ],
  },
  {
    name: 'Leg Curl',
    category: 'isolation',
    equipment: 'machine',
    exerciseType: 'strength',
    description: 'Hamstring isolation machine',
    energyCost: 'low',
    complexity: 'beginner',
    typicalDurationMinutes: 6,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'hamstrings', involvement: 'primary' },
    ],
  },
  {
    name: 'Lateral Raise',
    category: 'isolation',
    equipment: 'dumbbell',
    exerciseType: 'strength',
    description: 'Side delt isolation',
    energyCost: 'low',
    complexity: 'beginner',
    typicalDurationMinutes: 6,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'shoulders_side', involvement: 'primary' },
    ],
  },
  {
    name: 'Cable Fly',
    category: 'isolation',
    equipment: 'cable',
    exerciseType: 'strength',
    description: 'Chest isolation with cables',
    energyCost: 'low',
    complexity: 'beginner',
    typicalDurationMinutes: 6,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'chest', involvement: 'primary' },
    ],
  },

  // --- CARDIO EXERCISES ---
  {
    name: 'Running',
    category: 'cardio',
    equipment: 'none',
    exerciseType: 'cardio_distance',
    description: 'Outdoor or treadmill running',
    energyCost: 'high',
    complexity: 'beginner',
    typicalDurationMinutes: 30,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'cardio_system', involvement: 'primary' },
      { muscle: 'lower_body_endurance', involvement: 'primary' },
    ],
  },
  {
    name: 'Cycling',
    category: 'cardio',
    equipment: 'machine',
    exerciseType: 'cardio_distance',
    description: 'Stationary or outdoor cycling',
    energyCost: 'medium',
    complexity: 'beginner',
    typicalDurationMinutes: 30,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'cardio_system', involvement: 'primary' },
      { muscle: 'lower_body_endurance', involvement: 'primary' },
      { muscle: 'quads', involvement: 'secondary' },
    ],
  },
  {
    name: 'Rowing Machine',
    category: 'cardio',
    equipment: 'machine',
    exerciseType: 'cardio_duration',
    description: 'Full body cardio on rowing machine',
    energyCost: 'high',
    complexity: 'intermediate',
    typicalDurationMinutes: 20,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'cardio_system', involvement: 'primary' },
      { muscle: 'full_body', involvement: 'primary' },
      { muscle: 'back_lats', involvement: 'secondary' },
      { muscle: 'quads', involvement: 'secondary' },
    ],
  },

  // --- FUNCTIONAL EXERCISES ---
  {
    name: 'Burpees',
    category: 'functional',
    equipment: 'bodyweight',
    exerciseType: 'functional_reps',
    description: 'Full body explosive functional movement',
    energyCost: 'very_high',
    complexity: 'intermediate',
    typicalDurationMinutes: 10,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'full_body', involvement: 'primary' },
      { muscle: 'cardio_system', involvement: 'primary' },
    ],
  },
  {
    name: 'Box Jumps',
    category: 'functional',
    equipment: 'bodyweight',
    exerciseType: 'functional_reps',
    description: 'Explosive lower body power',
    energyCost: 'high',
    complexity: 'intermediate',
    typicalDurationMinutes: 8,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'quads', involvement: 'primary' },
      { muscle: 'glutes', involvement: 'primary' },
      { muscle: 'calves', involvement: 'secondary' },
    ],
  },
  {
    name: 'Plank',
    category: 'functional',
    equipment: 'bodyweight',
    exerciseType: 'isometric',
    description: 'Core stability hold',
    energyCost: 'low',
    complexity: 'beginner',
    typicalDurationMinutes: 5,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'core_stability', involvement: 'primary' },
      { muscle: 'abs', involvement: 'primary' },
      { muscle: 'lower_back', involvement: 'secondary' },
    ],
  },
  {
    name: 'Jump Rope',
    category: 'functional',
    equipment: 'none',
    exerciseType: 'interval',
    description: 'Cardio and coordination interval training',
    energyCost: 'medium',
    complexity: 'beginner',
    typicalDurationMinutes: 15,
    requiresSpotter: false,
    muscleGroups: [
      { muscle: 'cardio_system', involvement: 'primary' },
      { muscle: 'calves', involvement: 'secondary' },
      { muscle: 'forearms', involvement: 'secondary' },
    ],
  },
];

export async function seedExercises() {
  log.info({ count: exerciseSeeds.length }, 'seeding exercises');

  for (const seed of exerciseSeeds) {
    // Insert exercise
    const [exercise] = await db
      .insert(exercises)
      .values({
        name: seed.name,
        category: seed.category,
        equipment: seed.equipment,
        exerciseType: seed.exerciseType,
        description: seed.description,
        energyCost: seed.energyCost,
        complexity: seed.complexity,
        typicalDurationMinutes: seed.typicalDurationMinutes,
        requiresSpotter: seed.requiresSpotter,
      })
      .returning();

    // Insert muscle group mappings
    for (const mg of seed.muscleGroups) {
      await db.insert(exerciseMuscleGroups).values({
        exerciseId: exercise.id,
        muscleGroup: mg.muscle,
        involvement: mg.involvement,
      });
    }

    log.debug({ name: seed.name, category: seed.category }, 'exercise seeded');
  }

  log.info({ count: exerciseSeeds.length }, 'exercises seeded successfully');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await seedExercises();
  process.exit(0);
}
