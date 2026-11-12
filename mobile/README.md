# MANAWA Mobile App

Production-ready React Native mobile application for the MANAWA rental marketplace platform.

## Structure

```
mobile/
├── src/
│   ├── App.js                    # Root component with Redux & Navigation setup
│   ├── index.js                  # Entry point
│   ├── store/
│   │   ├── index.js             # Redux store configuration with persistence
│   │   └── slices/
│   │       ├── authSlice.js      # Authentication (login, register, logout, token refresh)
│   │       ├── userSlice.js      # User profile management
│   │       ├── bookingSlice.js   # Booking operations
│   │       ├── propertySlice.js  # Property search & details
│   │       └── networkSlice.js   # Network connectivity state
│   ├── navigation/
│   │   ├── RootNavigator.js      # Auth/App conditional routing
│   │   ├── AuthNavigator.js      # Onboarding, Login, Register, ForgotPassword
│   │   ├── AppNavigator.js       # Bottom Tab Navigation (Home, Search, Bookings, Profile)
│   │   └── stacks/
│   │       ├── HomeStack.js      # Home, PropertyDetails, BookingPreview
│   │       ├── SearchStack.js    # Search, SearchResults, PropertyDetails, BookingPreview
│   │       ├── BookingStack.js   # BookingsList, BookingDetails, BookingMessages
│   │       └── ProfileStack.js   # Profile, EditProfile, MyProperties, Settings
│   ├── screens/
│   │   ├── auth/
│   │   │   ├── SplashScreen.js           # Loading splash with logo
│   │   │   ├── OnboardingScreen.js       # 3-slide onboarding carousel
│   │   │   ├── LoginScreen.js            # Email/password login with validation
│   │   │   ├── RegisterScreen.js         # New account creation
│   │   │   └── ForgotPasswordScreen.js   # Password reset flow
│   │   ├── home/
│   │   │   └── HomeScreen.js             # Featured properties & quick actions
│   │   ├── search/
│   │   │   ├── SearchScreen.js           # Search filters (location, price)
│   │   │   └── SearchResultsScreen.js    # Property search results list
│   │   ├── property/
│   │   │   └── PropertyDetailsScreen.js  # Full property info, amenities, host
│   │   ├── booking/
│   │   │   ├── BookingPreviewScreen.js   # Date selection & price confirmation
│   │   │   ├── BookingsListScreen.js     # User's all bookings with status
│   │   │   ├── BookingDetailsScreen.js   # Single booking details
│   │   │   └── BookingMessagesScreen.js  # Chat with property host
│   │   └── profile/
│   │       ├── ProfileScreen.js          # User profile overview
│   │       ├── EditProfileScreen.js      # Edit name, phone, bio
│   │       ├── MyPropertiesScreen.js     # Host's property listings
│   │       └── SettingsScreen.js         # App settings, help, legal
│   ├── services/
│   │   ├── api.js                # Axios client with auth interceptors
│   │   ├── authService.js        # Login, register, logout, token refresh
│   │   ├── userService.js        # Profile CRUD, image upload
│   │   ├── bookingService.js     # Booking operations, messaging
│   │   └── propertyService.js    # Search, details, featured, nearby
│   ├── components/               # Reusable UI components (empty - add as needed)
│   ├── hooks/
│   │   ├── useApi.js             # API calls with loading/error states
│   │   ├── useLocation.js        # GPS location & reverse geocoding
│   │   └── index.js              # Hook exports
│   └── utils/
│       ├── constants.js          # App-wide constants & enums
│       ├── validators.js         # Input validation utilities
│       ├── formatters.js         # Date, price, phone formatting
│       └── storageUtils.js       # AsyncStorage wrapper for offline
├── assets/
│   ├── icon.png                  # App icon (replace with actual)
│   ├── splash.png                # Splash screen (replace with actual)
│   └── adaptive-icon.png         # Android adaptive icon
├── app.json                      # Expo configuration
├── eas.json                      # EAS build configuration
├── package.json                  # Dependencies & scripts
├── babel.config.js               # Babel with path aliases
├── tsconfig.json                 # TypeScript configuration
├── jest.config.js                # Test configuration
├── jest.setup.js                 # Test setup & mocks
├── .eslintrc.json                # ESLint configuration
├── .prettierrc                    # Prettier formatting
├── .gitignore                     # Git ignore rules
└── .env.example                   # Environment variables template
```

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Expo CLI: `npm install -g expo-cli`

### Installation

```bash
cd mobile
npm install
```

### Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env`:
```
EXPO_PUBLIC_API_URL=http://localhost:3000
EXPO_PUBLIC_ENABLE_OFFLINE_MODE=true
```

### Development

```bash
# Start Expo dev server
npm start

# Run on Android
npm run android

# Run on iOS
npm run ios

# Run on Web
npm run web
```

## Features

### Authentication
- Onboarding carousel
- Email/password login & registration
- Password reset flow
- Token refresh mechanism
- Persistent login state (Redux persist)

### Property Search
- Location-based search
- Price range filtering
- Featured properties on home
- Nearby properties (GPS)
- Property details with amenities
- Host information

### Bookings
- Date selection with calendar
- Price breakdown
- Booking confirmation
- Booking history with status
- Booking details & messaging
- Message host directly

### User Profile
- Profile editing (name, phone, bio)
- Profile image upload
- My properties listing (for hosts)
- Settings & preferences
- Logout

### Offline Support
- Redux persist (local state backup)
- AsyncStorage for credentials
- NetInfo connectivity detection
- Cached properties/bookings

## State Management

Redux with Redux Toolkit & Redux Persist:
- **auth** - Login state, token, user
- **user** - Profile data
- **booking** - User bookings
- **property** - Search results, filters, details
- **network** - Connectivity status

## API Integration

Axios client with:
- Authorization Bearer token
- Automatic token refresh (401 handling)
- Request/response interceptors
- Error handling

## Navigation Structure

```
RootNavigator
├─ Auth (if !isAuthenticated)
│  ├─ Onboarding
│  ├─ Login
│  ├─ Register
│  └─ ForgotPassword
└─ App (if isAuthenticated)
   ├─ Home Stack
   │  ├─ HomeScreen
   │  ├─ PropertyDetails
   │  └─ BookingPreview
   ├─ Search Stack
   │  ├─ SearchScreen
   │  ├─ SearchResults
   │  ├─ PropertyDetails
   │  └─ BookingPreview
   ├─ Bookings Stack
   │  ├─ BookingsList
   │  ├─ BookingDetails
   │  └─ BookingMessages
   └─ Profile Stack
      ├─ ProfileScreen
      ├─ EditProfile
      ├─ MyProperties
      └─ Settings
```

## Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm test:coverage

# Watch mode
npm test:watch
```

## Code Quality

```bash
# Lint
npm run lint

# Format
npm run format
```

## Building

### Development Build
```bash
eas build --platform android --profile development
eas build --platform ios --profile development
```

### Production Build
```bash
eas build --platform android --profile production
eas build --platform ios --profile production
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| EXPO_PUBLIC_API_URL | http://localhost:3000 | Backend API endpoint |
| EXPO_PUBLIC_API_TIMEOUT | 30000 | Request timeout (ms) |
| EXPO_PUBLIC_ENABLE_OFFLINE_MODE | true | Enable offline support |
| EXPO_PUBLIC_ENABLE_NOTIFICATIONS | true | Push notifications |

## Permissions

### Android
- ACCESS_FINE_LOCATION - GPS for nearby properties
- CAMERA - Take property photos
- READ_EXTERNAL_STORAGE - Upload images
- WRITE_EXTERNAL_STORAGE - Save images

### iOS
- Location (NSLocationWhenInUseUsageDescription)
- Camera (NSCameraUsageDescription)
- Photos (NSPhotoLibraryUsageDescription)

## Best Practices

1. **Components**: Keep functional, use hooks
2. **State**: Manage globally with Redux, locally with useState
3. **Styling**: Use StyleSheet for performance
4. **Validation**: Validate at API boundaries
5. **Error Handling**: Show user-friendly messages
6. **Offline**: Check network before API calls
7. **Testing**: 80%+ coverage on new code

## Troubleshooting

### Build Issues
```bash
# Clear cache
rm -rf node_modules .expo
npm install

# Rebuild
expo start --clear
```

### Android/iOS Specific
- Android: Check Android SDK & NDK versions
- iOS: Update Xcode & Ruby gems
- Both: Check permissions in app.json

## License

Proprietary - MANAWA 2026
