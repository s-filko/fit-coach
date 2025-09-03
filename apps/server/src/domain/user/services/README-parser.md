# Universal Parser Documentation

## Overview

The universal parser provides a flexible way to extract structured data from natural language text. Instead of hardcoded parsing logic, you define what fields to extract and their validation rules.

## Key Features

- **Flexible field definitions** - Define any fields with descriptions
- **Type validation** - Support for numbers, strings, booleans, enums
- **Range validation** - Min/max values for numbers
- **LLM-powered extraction** - Uses AI for accurate natural language understanding
- **Error handling** - Graceful fallback to null values

## Basic Usage

```typescript
import { FieldDefinition, UniversalParseRequest } from './prompt.service';
import { ProfileParserService } from './profile-parser.service';

// 1. Define fields to extract
const fields: FieldDefinition[] = [
  {
    key: 'age',
    description: 'User age in years',
    type: 'number',
    validation: { min: 10, max: 100 }
  },
  {
    key: 'gender',
    description: 'User gender',
    type: 'enum',
    enumValues: ['male', 'female']
  },
  {
    key: 'height',
    description: 'Height in centimeters',
    type: 'number',
    validation: { min: 120, max: 220 }
  }
];

// 2. Create parsing request
const request: UniversalParseRequest = {
  text: "I'm 28 years old, male, 175 cm tall",
  fields
};

// 3. Parse the text
const result = await parser.parseUniversal(request);

// Result:
// {
//   "age": 28,
//   "gender": "male",
//   "height": 175
// }
```

## Field Types

### Number Fields
```typescript
{
  key: 'age',
  description: 'User age in years',
  type: 'number',
  validation: {
    min: 0,
    max: 120
  }
}
```

### Enum Fields
```typescript
{
  key: 'priority',
  description: 'Task priority level',
  type: 'enum',
  enumValues: ['low', 'medium', 'high', 'urgent']
}
```

### Boolean Fields
```typescript
{
  key: 'isAvailable',
  description: 'Whether the item is available',
  type: 'boolean'
}
```

### String Fields
```typescript
{
  key: 'description',
  description: 'Detailed description',
  type: 'string',
  validation: {
    pattern: '^[A-Za-z0-9 ]+$' // Optional regex pattern
  }
}
```

## Advanced Usage

### Dynamic Field Creation
```typescript
const createFieldsBasedOnContext = (userType: string): FieldDefinition[] => {
  const baseFields = getBasicFields();

  if (userType === 'beginner') {
    baseFields.push({
      key: 'priorExperience',
      description: 'Previous sports experience',
      type: 'string'
    });
  }

  return baseFields;
};
```

### Error Handling
```typescript
try {
  const result = await parser.parseUniversal(request);

  // Check for missing critical fields
  if (!result.age) {
    console.log('Age not found, ask user to clarify');
  }

  // Use extracted data
  processUserData(result);
} catch (error) {
  console.error('Parsing failed:', error);
  // Fallback to manual input
}
```

## Best Practices

1. **Clear descriptions** - Make field descriptions specific and unambiguous
2. **Reasonable validation** - Set realistic min/max values
3. **Graceful fallbacks** - Always handle null values
4. **User confirmation** - Show extracted data to user for verification
5. **Context awareness** - Use different fields based on user context

## Example Use Cases

### User Profile Collection
- Age, gender, height, weight
- Fitness level, experience
- Goals and preferences

### Health Assessment
- Medical conditions
- Physical limitations
- Medication usage

### Preferences Collection
- Workout times, equipment access
- Dietary restrictions
- Motivation factors

### Dynamic Surveys
- Context-dependent questions
- Conditional field extraction
- Multi-step data collection

## Integration with Existing Code

The universal parser is fully compatible with the existing registration system:

```typescript
// In RegistrationService
const fields = createBasicProfileFields();
const request: UniversalParseRequest = { text: userMessage, fields };
const parsedData = await this.profileParser.parseUniversal(request);

// Use parsed data as before
if (parsedData.age && parsedData.gender) {
  // Update user profile
}
```
