# Migration Guide

## Applying Database Migrations

### Migration 0006: Change height and weight to numeric

**Purpose**: Support decimal values for height and weight (e.g., 180.5 cm, 72.5 kg)

**File**: `drizzle/0006_change_height_weight_to_numeric.sql`

### How to Apply

#### Option 1: Using psql (Recommended for production)
```bash
# Connect to your database
psql $DATABASE_URL

# Apply the migration
\i drizzle/0006_change_height_weight_to_numeric.sql

# Verify changes
\d users
```

#### Option 2: Using Drizzle Kit
```bash
cd apps/server

# Generate migration (if needed)
npx drizzle-kit generate

# Push to database
npx drizzle-kit push
```

#### Option 3: Manual SQL
```sql
-- Run this SQL directly in your database client
ALTER TABLE "users" 
  ALTER COLUMN "height" TYPE numeric(5,1) USING height::numeric(5,1);

ALTER TABLE "users" 
  ALTER COLUMN "weight" TYPE numeric(5,1) USING weight::numeric(5,1);
```

### Verification

After applying the migration, verify the changes:

```sql
-- Check column types
SELECT 
  column_name, 
  data_type, 
  numeric_precision, 
  numeric_scale
FROM information_schema.columns 
WHERE table_name = 'users' 
  AND column_name IN ('age', 'height', 'weight');

-- Expected output:
-- age    | integer | NULL | NULL
-- height | numeric | 5    | 1
-- weight | numeric | 5    | 1
```

### Data Safety

This migration is **safe** for existing data:
- Uses `USING height::numeric(5,1)` to convert existing integer values
- Existing integer values (e.g., 180) become numeric (180.0)
- No data loss occurs
- NULL values remain NULL

### Rollback (if needed)

```sql
-- WARNING: This will truncate decimal places
ALTER TABLE "users" 
  ALTER COLUMN "height" TYPE integer USING height::integer;

ALTER TABLE "users" 
  ALTER COLUMN "weight" TYPE integer USING weight::integer;
```

**Note**: Rollback will lose decimal precision (180.5 → 180)

### Testing After Migration

```bash
# Run all tests
npm test

# Expected: 233 tests passing
```

### Environment Variables

Make sure your `DATABASE_URL` is set:
```bash
# .env or .env.production
DATABASE_URL=postgresql://user:password@localhost:5432/fitcoach
```
