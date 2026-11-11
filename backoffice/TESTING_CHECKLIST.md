# MANAWA Responsive Dashboard - Testing Checklist

## Device Sizes to Test

### Mobile Devices
- [ ] iPhone 12 Mini (375px width)
- [ ] iPhone 12 (390px width)
- [ ] iPhone 12 Pro Max (428px width)
- [ ] Samsung Galaxy S21 (360px width)
- [ ] Pixel 6 (412px width)
- [ ] Small phone (320px width - minimum)

### Tablet Devices
- [ ] iPad (768px width, portrait)
- [ ] iPad Pro (1024px width, portrait)
- [ ] Samsung Galaxy Tab (600px width)
- [ ] Tablet landscape orientation

### Desktop
- [ ] 1024px (minimum desktop)
- [ ] 1366px (common laptop)
- [ ] 1920px (standard desktop)
- [ ] 2560px (large desktop)

## Navigation Testing

### Mobile (≤768px)
- [ ] Hamburger menu button visible
- [ ] Navigation menu hidden by default
- [ ] Click hamburger opens menu
- [ ] Menu appears as overlay/drawer
- [ ] Clicking menu item closes menu
- [ ] Pressing ESC closes menu
- [ ] Clicking outside menu closes menu
- [ ] Menu doesn't scroll body behind it

### Tablet (769px - 1024px)
- [ ] Hamburger menu visible
- [ ] Menu as side drawer when opened
- [ ] Can close menu and interact with content
- [ ] Menu smooth open/close animation

### Desktop (≥1025px)
- [ ] Hamburger menu hidden
- [ ] Navigation menu always visible
- [ ] Menu items in horizontal row
- [ ] No overlay on content

## Layout Testing

### Mobile
- [ ] Single column layout only
- [ ] No horizontal scrolling needed for main content
- [ ] Container padding appropriate (12-16px)
- [ ] No text overflow
- [ ] Images scale properly

### Tablet
- [ ] 2-column grids work
- [ ] Sidebar optional/collapsible
- [ ] Content readable at any orientation
- [ ] Landscape mode doesn't break layout

### Desktop
- [ ] 3-4 column grids available
- [ ] Sidebar always visible
- [ ] Optimal reading line length
- [ ] No wasted whitespace

## Touch Targets Testing

### Minimum Size (44x44px)
- [ ] All buttons have min 44x44px
- [ ] All links/clickable elements sized appropriately
- [ ] No overlapping clickable elements
- [ ] Finger-friendly spacing between targets

### Spacing
- [ ] Touch targets have 8px minimum gap
- [ ] Buttons have clear active state
- [ ] Feedback on tap (visual or haptic)

## Forms Testing

### Input Fields
- [ ] Font size 16px (no iOS auto-zoom)
- [ ] Minimum height 44px
- [ ] Clear focus state (border or shadow)
- [ ] Proper padding for content visibility
- [ ] Labels readable and associated

### Mobile
- [ ] Full-width input fields
- [ ] Full-width select dropdowns
- [ ] Mobile keyboard appears correctly
  - [ ] Text input = text keyboard
  - [ ] Email input = email keyboard
  - [ ] Phone input = number keyboard
- [ ] Numeric inputs allow scrolling
- [ ] Date picker works properly

### Validation
- [ ] Error messages visible and clear
- [ ] Error styling doesn't rely on color alone
- [ ] Required field indicators clear
- [ ] Hint text helpful and readable

## Tables Testing

### Desktop View
- [ ] All columns visible
- [ ] Sortable columns clickable
- [ ] Action buttons accessible
- [ ] Row hover effect works

### Tablet View
- [ ] Horizontal scroll enabled
- [ ] Sticky header visible while scrolling
- [ ] All content accessible via scroll
- [ ] Touch scrolling smooth

### Mobile View (if using card layout)
- [ ] Each record displayed as card
- [ ] All fields visible in card
- [ ] Action buttons full-width/vertical
- [ ] Cards stacked vertically
- [ ] Good spacing between cards

### Mobile View (if using scroll)
- [ ] Table scrollable horizontally
- [ ] Sticky first column (if applicable)
- [ ] Header remains visible
- [ ] Touch scrolling smooth and fast

## Modal Testing

### Desktop
- [ ] Modal centered on screen
- [ ] Max-width applied (600px)
- [ ] Can close with X button
- [ ] Can close with ESC key
- [ ] Can close by clicking backdrop
- [ ] Scrollable if content too long

### Tablet
- [ ] Modal responsive width
- [ ] Takes up appropriate screen space
- [ ] All buttons reachable
- [ ] Closing works properly

### Mobile
- [ ] Modal takes full screen (95% with margins)
- [ ] Slides in from bottom animation
- [ ] Close button accessible
- [ ] Content scrollable within modal
- [ ] Buttons arranged vertically
- [ ] Footer buttons full-width
- [ ] No overflow/cutoff content

## Cards & Components Testing

### Cards
- [ ] Card titles readable
- [ ] Proper padding and margins
- [ ] Footer buttons wrap correctly on mobile
- [ ] No content overflow

### Buttons
- [ ] Primary, secondary, danger variants visible
- [ ] Hover/active states work
- [ ] Icons and text aligned properly
- [ ] Small buttons still readable

### KPI/Stat Tiles
- [ ] Numbers readable
- [ ] Labels clear
- [ ] Change indicators visible (↑↓)
- [ ] Colors distinguish positive/negative

## Animations & Transitions

### Mobile
- [ ] Animations don't cause lag
- [ ] Transitions smooth and quick
- [ ] No animation causing layout shift
- [ ] Can disable with prefers-reduced-motion

### Performance
- [ ] No noticeable jank
- [ ] Scrolling 60fps
- [ ] Menu open/close <300ms
- [ ] Modal animations smooth

## Orientation Testing

### Portrait → Landscape
- [ ] Layout adapts correctly
- [ ] Menu closes automatically
- [ ] No content hidden or cutoff
- [ ] Touch targets still accessible

### Landscape → Portrait
- [ ] Layout adapts back smoothly
- [ ] No content loss
- [ ] Navigation still works

## Font & Text Testing

### Readability
- [ ] Body text font size ≥14px
- [ ] Line height sufficient (1.5+)
- [ ] Contrast ratio ≥4.5:1 (WCAG AA)
- [ ] Labels clear and distinct

### Mobile
- [ ] Text doesn't zoom unexpectedly
- [ ] No text overflow beyond viewport
- [ ] Paragraphs not too long
- [ ] Line breaks appropriate

## Spacing & Margins Testing

### Mobile (≤480px)
- [ ] Padding: 12-16px on container
- [ ] Margin-bottom: 12-16px between elements
- [ ] Card padding: 12-16px
- [ ] Button padding: 10-12px

### Tablet (481px-1024px)
- [ ] Padding: 16px on container
- [ ] Margin-bottom: 16-20px between elements
- [ ] Card padding: 16-20px
- [ ] Button padding: 12-14px

### Desktop (≥1025px)
- [ ] Padding: 20px+ on container
- [ ] Margin-bottom: 20-24px between elements
- [ ] Card padding: 20px
- [ ] Button padding: 14-16px

## Images & Media Testing

### Responsive Images
- [ ] Images scale with viewport
- [ ] No pixelation on high-DPI
- [ ] Load times acceptable
- [ ] SVG icons scale properly
- [ ] Alt text provided

### Mobile
- [ ] Images don't overflow
- [ ] Aspect ratios maintained
- [ ] Loading placeholders if needed

## Performance Testing

### Mobile (4G network)
- [ ] Page loads in <3 seconds
- [ ] CSS loads without blocking
- [ ] JavaScript doesn't block rendering
- [ ] Responsive.css <50KB (gzipped)

### Desktop
- [ ] Smooth scrolling
- [ ] Instant interactions
- [ ] No layout thrashing

## Accessibility Testing

### Keyboard Navigation
- [ ] Tab order makes sense
- [ ] Focus indicators visible
- [ ] Can access all functionality via keyboard
- [ ] Menu accessible via keyboard
- [ ] Escape key closes modals

### Screen Readers
- [ ] Navigation landmarks present
- [ ] Form labels associated
- [ ] Images have alt text
- [ ] Buttons/links descriptive
- [ ] ARIA labels where needed

### Color Contrast
- [ ] Primary text vs background ≥4.5:1
- [ ] Secondary text vs background ≥3:1
- [ ] Button text readable
- [ ] Status indicators not color-only

## Browser Testing

- [ ] Chrome latest
- [ ] Firefox latest
- [ ] Safari latest
- [ ] Edge latest
- [ ] Chrome Mobile (Android)
- [ ] Safari Mobile (iOS)
- [ ] Samsung Internet
- [ ] Firefox Mobile

## Real Device Testing

Essential - Don't rely only on DevTools:

### Mobile
- [ ] Actual phone (iOS and Android)
- [ ] Test on real 4G connection
- [ ] Check battery impact
- [ ] Test with one hand
- [ ] Check glare in sunlight

### Tablet
- [ ] Actual iPad or tablet
- [ ] Portrait and landscape
- [ ] Multi-touch gestures

## Bug Report Template

```
Title: [Component] [Issue] on [Device]

Device: [Model, OS Version]
Screen Size: [Width x Height]
Browser: [Name, Version]

Steps to Reproduce:
1.
2.
3.

Expected Result:
[What should happen]

Actual Result:
[What actually happens]

Screenshot/Video:
[Attach if possible]

Severity: [Critical/High/Medium/Low]
```

## Sign-Off Checklist

- [ ] All breakpoints tested
- [ ] All components tested
- [ ] Navigation works on all devices
- [ ] Forms touch-friendly
- [ ] Tables responsive
- [ ] Modals work properly
- [ ] No console errors
- [ ] Performance acceptable
- [ ] Accessibility requirements met
- [ ] Real device testing complete
- [ ] Cross-browser testing complete
- [ ] Ready for production

## Quick Test (5 minutes)

1. Open on mobile (≤480px)
   - [ ] Click hamburger, menu opens
   - [ ] Fill form, buttons work
   - [ ] No overflow/scroll issues

2. Open on tablet (768px)
   - [ ] Layout adapts
   - [ ] Touch targets work
   - [ ] Menu accessible

3. Open on desktop (1024px+)
   - [ ] Full layout visible
   - [ ] Menu always visible
   - [ ] All features accessible

4. Test orientation changes
   - [ ] Layout adapts
   - [ ] No content lost

5. Check console
   - [ ] No JavaScript errors
   - [ ] No CSS warnings
