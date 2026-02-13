-- Change height and weight columns from integer to numeric to support decimal values
-- Age remains integer (will be rounded from user input)

ALTER TABLE "users" 
  ALTER COLUMN "height" TYPE numeric(5,1) USING height::numeric(5,1);

ALTER TABLE "users" 
  ALTER COLUMN "weight" TYPE numeric(5,1) USING weight::numeric(5,1);

-- Add comments for clarity
COMMENT ON COLUMN "users"."age" IS 'User age in years (integer, rounded from input)';
COMMENT ON COLUMN "users"."height" IS 'User height in cm (supports decimals, e.g., 180.5)';
COMMENT ON COLUMN "users"."weight" IS 'User weight in kg (supports decimals, e.g., 72.5)';
