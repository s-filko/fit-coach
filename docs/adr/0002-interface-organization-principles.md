# ADR 0002: Interface Organization Principles

## Context

The project was experiencing issues with interface organization where all domain interfaces were stored in a single `ports.ts` file. This led to several problems:

### Problems with Monolithic Interface Files
- **Violation of Single Responsibility Principle**: One file responsible for multiple different contracts
- **Navigation Complexity**: 60+ lines with 5+ different interfaces in one file
- **Mixed Abstraction Levels**: Repository, service, and utility interfaces in the same file
- **Maintenance Difficulty**: Changes to one interface could affect imports across many files
- **Poor Scalability**: As the project grows, the single file becomes unwieldy

### Current State
- All user domain interfaces were in `domain/user/ports.ts` (60+ lines)
- Mixed repository, service, and utility interfaces
- Difficult to locate specific interfaces
- Hard to understand interface relationships

## Decision

### Interface Organization by Functional Areas

We will organize interfaces by **functional areas** and **abstraction levels** rather than keeping them in a single file.

#### New Structure
```
domain/user/ports/
├── index.ts              # Re-exports for convenience
├── repository.ports.ts   # Data access contracts
├── service.ports.ts      # Business logic contracts  
└── prompt.ports.ts       # Specialized prompt interfaces
```

#### Organization Principles

1. **Separation by Responsibility**:
   - `repository.ports.ts` - Data access layer contracts
   - `service.ports.ts` - Business logic layer contracts
   - `prompt.ports.ts` - Specialized utility contracts

2. **Single Responsibility per File**:
   - Each file handles one functional area
   - Clear boundaries between different abstraction levels
   - Easier to locate and modify specific interfaces

3. **Backward Compatibility**:
   - Main `ports.ts` file re-exports from new structure
   - Existing imports continue to work
   - Gradual migration path available

4. **File Size Limits**:
   - Keep interface files under 50 lines
   - Split further if they grow beyond this limit
   - Maintain readability and navigability

### Implementation Details

#### File Organization
- **Repository Ports**: Data access contracts (UserRepository, etc.)
- **Service Ports**: Business logic contracts (UserService, RegistrationService, etc.)
- **Specialized Ports**: Domain-specific utilities (PromptService, etc.)

#### Import Strategy
- Use `index.ts` for convenient re-exports
- Maintain existing import paths for backward compatibility
- Allow direct imports from specific files for new code

## Consequences

### Positive
- **Better Organization**: Clear separation of concerns
- **Improved Maintainability**: Easier to locate and modify interfaces
- **Enhanced Readability**: Smaller, focused files
- **Better Scalability**: Easy to add new interfaces in appropriate files
- **Clearer Architecture**: Interface relationships are more obvious

### Negative
- **Initial Refactoring Effort**: Required updating imports across the codebase
- **More Files**: Increased file count (but better organization)
- **Learning Curve**: Developers need to understand new structure

### Risks
- **Import Confusion**: Multiple ways to import the same interface
- **Inconsistent Usage**: Mix of old and new import patterns

### Mitigation
- Maintain backward compatibility through re-exports
- Document new patterns clearly
- Use ESLint rules to enforce consistent imports

## Implementation Status

### Completed
- ✅ Created modular port structure in `domain/user/ports/`
- ✅ Split interfaces by functional areas
- ✅ Maintained backward compatibility
- ✅ All tests passing (158/158)
- ✅ No linting errors

### File Structure
```
domain/user/ports/
├── index.ts (5 lines)           # Re-exports
├── repository.ports.ts (12 lines)  # Data access
├── service.ports.ts (32 lines)     # Business logic
└── prompt.ports.ts (23 lines)      # Specialized utilities
```

### Migration Results
- **Before**: 1 file, 60+ lines, 5 interfaces
- **After**: 4 files, 12-32 lines each, clear separation
- **Backward Compatibility**: 100% maintained
- **Test Coverage**: All tests passing

## Future Considerations

### Scaling Guidelines
1. **File Size**: Keep interface files under 50 lines
2. **New Domains**: Apply same principles to new domains
3. **Specialized Interfaces**: Create new files for distinct functional areas
4. **Cross-Domain**: Consider shared interfaces in `shared/ports/`

### Migration Path
1. **Phase 1**: Apply to user domain (completed)
2. **Phase 2**: Apply to AI and training domains
3. **Phase 3**: Remove backward compatibility re-exports (optional)

---

*Status: Implemented*
*Decision Date: 2025-01-07*
*Author: Serhii Filko*
*Related: ADR 0001 (AI System Integration)*
