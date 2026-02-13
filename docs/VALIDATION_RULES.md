# Validation Rules

## Profile Data Validation

### Overview

All numeric profile fields accept decimal values from user input. The system applies reasonable validation ranges to prevent absurd values while accommodating edge cases.

### Validation Ranges

| Field | Type | Min | Max | Storage | Notes |
|-------|------|-----|-----|---------|-------|
| **Age** | number | 10 | 120 | integer | Rounded to nearest integer (29.7 → 30, 24.4 → 24) |
| **Height** | number | 100 | 250 | numeric(5,1) | Preserves decimal precision (180.5 cm) |
| **Weight** | number | 20 | 300 | numeric(5,1) | Preserves decimal precision (72.5 kg) |
| **Gender** | string | - | - | text | Enum: "male" or "female" |
| **Fitness Level** | string | - | - | text | Enum: "beginner", "intermediate", "advanced" |
| **Fitness Goal** | string | 1 char | 100 chars | text | Free text, trimmed |

### Rationale

#### Age: 10-120 years
- **Min 10**: Children can start structured fitness programs around this age
- **Max 120**: Accommodates elderly users (oldest verified human: 122 years)
- **Rounded**: Age is typically expressed as whole numbers

#### Height: 100-250 cm
- **Min 100**: Accommodates children and people with dwarfism (~3'3")
- **Max 250**: Accommodates very tall individuals (~8'2", tallest verified: 272cm)
- **Decimal**: Some people track height precisely (e.g., 180.5 cm)

#### Weight: 20-300 kg
- **Min 20**: Accommodates underweight children (~44 lbs)
- **Max 300**: Accommodates very heavy adults (~660 lbs)
- **Decimal**: Weight is commonly measured with precision (e.g., 72.5 kg)

### Examples

#### Valid Inputs
```typescript
// Typical adult
{ age: 30, height: 180, weight: 75 }

// Decimal values
{ age: 29.7, height: 180.5, weight: 72.5 }
// Stored as: { age: 30, height: 180.5, weight: 72.5 }

// Edge case: child
{ age: 10, height: 100.5, weight: 20.5 }

// Edge case: very tall/heavy
{ age: 35, height: 220.5, weight: 150.8 }

// Edge case: elderly
{ age: 120, height: 165, weight: 60 }
```

#### Invalid Inputs (Rejected)
```typescript
// Too young
{ age: 5 } // ❌ Min is 10

// Too old
{ age: 1000 } // ❌ Max is 120

// Impossible height
{ age: 30, height: 500 } // ❌ Max is 250

// Impossible weight
{ age: 30, weight: 500 } // ❌ Max is 300

// Too light
{ age: 30, weight: 10 } // ❌ Min is 20
```

### Implementation

#### Schema Definition
```typescript
// apps/server/src/infra/db/schema.ts
export const users = pgTable('users', {
  age: integer('age'), // Rounded from user input
  height: numeric('height', { precision: 5, scale: 1 }), // e.g., 180.5
  weight: numeric('weight', { precision: 5, scale: 1 }), // e.g., 72.5
  // ...
});
```

#### Validation
```typescript
// apps/server/src/domain/user/services/registration.validation.ts
const ageSchema = z.union([
  z.number()
    .min(10, 'Age must be at least 10 years')
    .max(120, 'Age must be at most 120 years')
    .transform((v) => Math.round(v)), // Round to integer
  z.null(),
]).transform((v) => v ?? undefined);

const heightSchema = z.union([
  z.number()
    .min(100, 'Height must be at least 100 cm')
    .max(250, 'Height must be at most 250 cm'),
  z.null(),
]).transform((v) => v ?? undefined);

const weightSchema = z.union([
  z.number()
    .min(20, 'Weight must be at least 20 kg')
    .max(300, 'Weight must be at most 300 kg'),
  z.null(),
]).transform((v) => v ?? undefined);
```

#### Repository Conversion
```typescript
// apps/server/src/infra/db/repositories/user.repository.ts
function parseNumeric(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

function mapRowToUser(row: UserRow): User {
  return {
    // ...
    height: parseNumeric(row.height), // Convert Drizzle string to number
    weight: parseNumeric(row.weight),
  };
}
```

### Migration

```sql
-- drizzle/0006_change_height_weight_to_numeric.sql
ALTER TABLE "users" 
  ALTER COLUMN "height" TYPE numeric(5,1) USING height::numeric(5,1);

ALTER TABLE "users" 
  ALTER COLUMN "weight" TYPE numeric(5,1) USING weight::numeric(5,1);
```

### Testing

```typescript
// Decimal values preserved
expect(result.updatedUser.height).toBe(180.5);
expect(result.updatedUser.weight).toBe(72.5);

// Age rounded
expect(result.updatedUser.age).toBe(30); // from 29.7

// Invalid values rejected
expect(result.updatedUser.age).toBeUndefined(); // from 1000
expect(result.updatedUser.weight).toBeUndefined(); // from 500
```

### User Experience

When user provides invalid values, the LLM will:
1. Detect the validation failure (field not saved)
2. Politely ask for correction with hints
3. Example: "Вес 500 кг кажется неправильным. Обычно вес от 20 до 300 кг. Уточни, пожалуйста?"

### Fitness Goal: Free Text

**Current Implementation**: Stored in user's original language (Russian, English, etc.)

**Rationale**:
- Preserves exact user intent and nuances
- User sees their own words in profile
- Simpler for MVP
- LLM can understand multiple languages

**Example values**:
- "похудеть и подкачаться"
- "lose weight and build muscle"
- "maintain fitness"
- "prepare for marathon"

**Future Enhancement** (post-MVP):
When analytics are needed, add normalized field:
```typescript
{
  fitnessGoal: "похудеть и подкачаться", // Original for display
  fitnessGoalNormalized: "lose_weight,build_muscle" // For analytics
}
```

This allows:
- User segmentation by goals
- ML/analytics on structured data
- Preserving original user language

### Future Considerations

- Add unit conversion (lbs → kg, inches → cm)
- Add more specific validation messages
- Consider different ranges for children vs adults
- Add warnings for extreme but valid values (e.g., BMI concerns)
- Add normalized fitness goal field for analytics (post-MVP)
