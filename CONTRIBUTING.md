# Contributing to FluidCNC

Thank you for your interest in contributing to FluidCNC! This document provides guidelines and information for contributors.

## 🚀 Quick Start

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/deadlysin777/fluidcnc.git
   cd fluidcnc/fluidcnc
   ```

2. **Start local server**
   ```bash
   python -m http.server 8080
   # or for HTTPS (required for Web Serial API):
   python https-server.py
   ```

3. **Open in browser**
   ```
   http://localhost:8080
   # or https://localhost:8443 for serial access
   ```

### First-Time Setup for Serial Access

Web Serial API requires HTTPS. Generate self-signed certificates:
```bash
python generate-cert.py
python https-server.py
```

## 📁 Project Architecture

### Core Concepts

- **No build step**: All JavaScript is served directly
- **Coordinator pattern**: `FluidCNCApp` in `app.js` owns state and instantiates modules
- **Event-driven**: `GrblHAL` class emits events, modules subscribe
- **Static hosting**: Works from any web server (Python, nginx, etc.)

### Key Files

| File | Purpose |
|------|---------|
| `index.html` | Main UI, script loading order |
| `app.js` | Main coordinator (`FluidCNCApp` class) |
| `grblhal.js` | Transport layer, grblHAL protocol |
| `machine-enhancements.js` | ML intelligence system (5,700+ lines) |
| `chatter-detection.js` | ESP32 sensor integration |
| `sw.js` | PWA service worker |

### Script Load Order (CRITICAL)

Scripts must load in this order in `index.html`:
```html
<script src="grblhal.js"></script>
<!-- feature modules -->
<script src="app.js"></script>  <!-- MUST be last -->
```

## 🔧 Development Guidelines

### Adding a New Feature Module

1. **Create your module** as a global class:
   ```javascript
   // my-feature.js
   class MyFeature {
       constructor(options) {
           this.grbl = options.grbl;
           this.app = options.app;
       }
       
       init() {
           // Setup event listeners
           this.grbl.on('status', (state) => this.onStatus(state));
       }
   }
   ```

2. **Add to `index.html`** (BEFORE `app.js`):
   ```html
   <script src="my-feature.js?v=1"></script>
   ```

3. **Instantiate in `app.js`** in `init()` method:
   ```javascript
   this.myFeature = new MyFeature({ grbl: this.grbl, app: this });
   ```

4. **Update `sw.js`**:
   - Add `/my-feature.js` to `CORE_ASSETS`
   - Bump `CACHE_NAME` version

### DOM Caching Pattern

Always cache DOM elements in `cacheElements()`:
```javascript
cacheElements() {
    this.elements = {
        myButton: document.getElementById('my-button'),
        myPanel: document.getElementById('my-panel')
    };
}
```

### Event System

Use the grblHAL event system:
```javascript
// Subscribe to events
this.grbl.on('status', (state) => { /* handle status */ });
this.grbl.on('alarm', (code) => { /* handle alarm */ });
this.grbl.on('probe', (result) => { /* handle probe */ });

// Send commands
grbl.send('G0 X10');                        // Fire and forget
await grbl.sendAndWait('G28.1', 5000);      // Wait for 'ok'
grbl.streamGCode(lines, { onProgress });    // Stream large files
```

### NaN Protection

**CRITICAL**: Always protect against NaN in calculations:
```javascript
const value = Number.isNaN(result) ? fallbackValue : result;
```

This is especially important in:
- Neural network calculations (`machine-enhancements.js`)
- Sensor data processing
- Any division operations

### Null-Safe DOM Access

Always check for element existence:
```javascript
const element = document.querySelector('#my-element');
if (element) {
    element.textContent = 'Updated';
}
```

## 🧪 Testing

### Manual Testing Checklist

Before submitting changes:

- [ ] UI loads without console errors
- [ ] WebSocket connection works
- [ ] Serial connection works (with HTTPS)
- [ ] Jog buttons function correctly
- [ ] Status updates display properly
- [ ] Alarm handling works (test with `ALARM:1`)
- [ ] PWA installs and works offline

### Testing Machine Enhancements

```javascript
// In browser console:
app.enhancements.getIntelligenceStatus()  // Check ML status
app.enhancements.predict([0.5, 0.3, 0.5, 0.6, 0.5, 0.3, 3])  // Test prediction
```

## 📝 Code Style

### JavaScript

- Use ES6+ features (classes, arrow functions, async/await)
- Meaningful variable names
- JSDoc comments for public methods
- 4-space indentation

### HTML

- Semantic HTML5 elements
- IDs use kebab-case (`my-button`)
- Classes use kebab-case (`tool-panel`)

### CSS

- CSS custom properties for theming
- Mobile-first responsive design
- BEM-like naming when appropriate

## 🔀 Pull Request Process

1. **Fork** the repository
2. **Create a feature branch**: `git checkout -b feature/my-feature`
3. **Make your changes**
4. **Test thoroughly** (see testing checklist)
5. **Update documentation** if needed
6. **Update `sw.js`** if adding files (bump `CACHE_NAME`)
7. **Submit PR** with clear description

### PR Description Template

```markdown
## What does this PR do?
Brief description of changes.

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing done
- Tested on Chrome/Edge
- Tested with grblHAL firmware v[version]
- [ ] WebSocket connection tested
- [ ] Serial connection tested

## Screenshots
If applicable, add screenshots.
```

## 🐛 Reporting Issues

### Bug Reports

Include:
- Browser and version
- grblHAL firmware version
- Steps to reproduce
- Console errors (if any)
- Screenshots (if applicable)

### Feature Requests

Include:
- Use case description
- Proposed implementation (optional)
- Any relevant examples

## 📚 Additional Resources

- [README.md](README.md) - Project overview
- [FEATURE_ROADMAP.md](FEATURE_ROADMAP.md) - Development roadmap
- [docs/MACHINE_ENHANCEMENTS.md](docs/MACHINE_ENHANCEMENTS.md) - ML system documentation
- [docs/HARDWARE_ADDITIONS.md](docs/HARDWARE_ADDITIONS.md) - Hardware setup
- [docs/wiring-guide.html](docs/wiring-guide.html) - Complete wiring guide

## 💬 Questions?

- Open a GitHub issue for bugs/features
- Check existing issues before creating new ones
- Review closed issues for common solutions

---

Thank you for contributing! 🎉
