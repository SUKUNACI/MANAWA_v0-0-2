# Reusable Components

This directory contains reusable UI components shared across screens.

## Structure

```
components/
├── Button.js                 # Primary/secondary action buttons
├── Card.js                   # Generic card container
├── Input.js                  # Text input with validation
├── Loading.js                # Loading spinner overlay
├── Modal.js                  # Dialog/modal component
├── Toast.js                  # Toast notifications
├── Header.js                 # Screen header
├── Footer.js                 # Screen footer
└── PropertyCard.js           # Reusable property card
```

## Component Patterns

### Button Component
```javascript
// Usage
<Button 
  title="Book Now" 
  onPress={handlePress}
  variant="primary"
  size="large"
  loading={isLoading}
  disabled={isDisabled}
/>

// Variants: primary, secondary, danger, success
// Sizes: small, medium, large
```

### Card Component
```javascript
// Usage
<Card
  title="Property Name"
  subtitle="Location"
  onPress={() => {}}
  image={<Image />}
>
  {/* Card content */}
</Card>
```

### Input Component
```javascript
// Usage
<Input
  label="Email"
  placeholder="you@example.com"
  value={email}
  onChangeText={setEmail}
  error={emailError}
  type="email"
  required
/>
```

### PropertyCard Component
```javascript
// Usage
<PropertyCard
  property={property}
  onPress={() => navigate('PropertyDetails')}
  showPrice={true}
  showRating={true}
/>
```

## Adding New Components

1. Create component in `components/ComponentName.js`
2. Export from this README
3. Use across screens
4. Keep components small & focused (<100 lines)
5. Use prop-types or TypeScript for documentation

## Best Practices

- ✅ Keep components pure & reusable
- ✅ Accept style props for customization
- ✅ Avoid business logic in components
- ✅ Use proper TypeScript/prop-types
- ✅ Export from index.js for clean imports
- ✅ Document props with JSDoc comments
