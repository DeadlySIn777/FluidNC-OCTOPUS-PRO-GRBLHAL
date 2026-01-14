/**
 * FluidCNC Unit Tests
 * 
 * Simple test framework for critical functions
 * Run in browser console or with Node.js
 * 
 * Usage:
 *   - In browser: Include this file and call runTests()
 *   - Node.js: node tests/tests.js
 */

// Simple test framework
class TestRunner {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
        this.errors = [];
    }
    
    test(name, fn) {
        this.tests.push({ name, fn });
    }
    
    async run() {
        console.log('🧪 FluidCNC Unit Tests\n' + '='.repeat(50));
        
        for (const test of this.tests) {
            try {
                await test.fn();
                console.log(`✅ ${test.name}`);
                this.passed++;
            } catch (e) {
                console.log(`❌ ${test.name}`);
                console.log(`   Error: ${e.message}`);
                this.failed++;
                this.errors.push({ name: test.name, error: e });
            }
        }
        
        console.log('\n' + '='.repeat(50));
        console.log(`Results: ${this.passed} passed, ${this.failed} failed`);
        
        return { passed: this.passed, failed: this.failed, errors: this.errors };
    }
}

// Assertion helpers
function assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
        throw new Error(`${message} Expected: ${expected}, Got: ${actual}`);
    }
}

function assertDeepEqual(actual, expected, message = '') {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${message} Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
    }
}

function assertTrue(value, message = '') {
    if (!value) {
        throw new Error(message || 'Expected true, got false');
    }
}

function assertFalse(value, message = '') {
    if (value) {
        throw new Error(message || 'Expected false, got true');
    }
}

function assertThrows(fn, message = '') {
    try {
        fn();
        throw new Error(message || 'Expected function to throw');
    } catch (e) {
        if (e.message === (message || 'Expected function to throw')) {
            throw e;
        }
        // Expected error was thrown
    }
}

// ================================================================
// G-code Parser Tests
// ================================================================

const runner = new TestRunner();

runner.test('G-code Parser: Parse simple G0 command', () => {
    // Mock parser if not loaded
    const line = 'G0 X100 Y50 Z-5';
    
    // Basic regex parsing test
    const xMatch = line.match(/X([\d.\-]+)/);
    const yMatch = line.match(/Y([\d.\-]+)/);
    const zMatch = line.match(/Z([\d.\-]+)/);
    
    assertEqual(xMatch?.[1], '100');
    assertEqual(yMatch?.[1], '50');
    assertEqual(zMatch?.[1], '-5');
});

runner.test('G-code Parser: Parse G1 with feed rate', () => {
    const line = 'G1 X10 Y20 F1500';
    
    const fMatch = line.match(/F([\d.]+)/);
    assertEqual(fMatch?.[1], '1500');
});

runner.test('G-code Parser: Parse arc command G2', () => {
    const line = 'G2 X10 Y10 I5 J0 F800';
    
    const iMatch = line.match(/I([\d.\-]+)/);
    const jMatch = line.match(/J([\d.\-]+)/);
    
    assertEqual(iMatch?.[1], '5');
    assertEqual(jMatch?.[1], '0');
});

runner.test('G-code Parser: Ignore comments', () => {
    const line = 'G0 X100 ; This is a comment';
    const cleaned = line.split(';')[0].trim();
    
    assertEqual(cleaned, 'G0 X100');
});

runner.test('G-code Parser: Handle parenthetical comments', () => {
    const line = 'G0 (move to start) X100 Y50';
    const cleaned = line.replace(/\([^)]*\)/g, '').trim();
    
    assertEqual(cleaned, 'G0  X100 Y50');
});

// ================================================================
// Levenshtein Distance Tests (AI typo correction)
// ================================================================

function levenshteinDistance(a, b) {
    const matrix = [];
    
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[b.length][a.length];
}

runner.test('Levenshtein: Identical strings', () => {
    assertEqual(levenshteinDistance('spindle', 'spindle'), 0);
});

runner.test('Levenshtein: Single character difference', () => {
    assertEqual(levenshteinDistance('spindle', 'spindel'), 2); // swap e and l
});

runner.test('Levenshtein: Missing character', () => {
    assertEqual(levenshteinDistance('home', 'hom'), 1);
});

runner.test('Levenshtein: Extra character', () => {
    assertEqual(levenshteinDistance('jog', 'jogg'), 1);
});

runner.test('Levenshtein: Completely different', () => {
    assertTrue(levenshteinDistance('abc', 'xyz') === 3);
});

// ================================================================
// Slang Translation Tests
// ================================================================

const slangMap = {
    'spinny thing': 'spindle',
    'cutter': 'tool',
    'router': 'spindle',
    'head': 'spindle',
    'motor': 'spindle',
    'bit': 'tool',
    'fast': 'rapid',
    'quick': 'rapid',
    'slow': 'feed',
    'speed': 'feed rate'
};

function translateSlang(text) {
    let result = text.toLowerCase();
    for (const [slang, proper] of Object.entries(slangMap)) {
        result = result.replace(new RegExp(slang, 'gi'), proper);
    }
    return result;
}

runner.test('Slang: Translate spinny thing', () => {
    assertEqual(translateSlang('turn on the spinny thing'), 'turn on the spindle');
});

runner.test('Slang: Translate cutter to tool', () => {
    assertEqual(translateSlang('check the cutter'), 'check the tool');
});

runner.test('Slang: Multiple translations', () => {
    const result = translateSlang('turn on spinny thing fast');
    assertTrue(result.includes('spindle'));
    assertTrue(result.includes('rapid'));
});

// ================================================================
// Number Word Parsing Tests
// ================================================================

const numberWords = {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
    'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
    'ten': 10, 'twenty': 20, 'thirty': 30, 'fifty': 50, 'hundred': 100
};

function parseNumberWords(text) {
    let result = text.toLowerCase();
    for (const [word, num] of Object.entries(numberWords)) {
        result = result.replace(new RegExp(`\\b${word}\\b`, 'gi'), num.toString());
    }
    return result;
}

runner.test('Number Words: Parse single word', () => {
    assertEqual(parseNumberWords('move five millimeters'), 'move 5 millimeters');
});

runner.test('Number Words: Parse multiple words', () => {
    const result = parseNumberWords('jog ten left then five up');
    assertTrue(result.includes('10'));
    assertTrue(result.includes('5'));
});

// ================================================================
// Unit Conversion Tests
// ================================================================

function mmToInch(mm) {
    return mm / 25.4;
}

function inchToMm(inch) {
    return inch * 25.4;
}

runner.test('Unit Conversion: mm to inch', () => {
    assertEqual(mmToInch(25.4).toFixed(4), '1.0000');
});

runner.test('Unit Conversion: inch to mm', () => {
    assertEqual(inchToMm(1).toFixed(1), '25.4');
});

runner.test('Unit Conversion: Common values', () => {
    assertEqual(inchToMm(0.125).toFixed(4), '3.1750'); // 1/8"
    assertEqual(inchToMm(0.25).toFixed(2), '6.35');    // 1/4"
});

// ================================================================
// Buffer Management Tests
// ================================================================

class MockBuffer {
    constructor(size = 128) {
        this.maxSize = size;
        this.used = 0;
        this.pending = [];
    }
    
    canFit(cmdLength) {
        return (this.used + cmdLength + 1) <= this.maxSize; // +1 for newline
    }
    
    add(cmd) {
        const length = cmd.length + 1;
        if (!this.canFit(cmd.length)) {
            return false;
        }
        this.used += length;
        this.pending.push({ cmd, length });
        return true;
    }
    
    remove() {
        if (this.pending.length === 0) return null;
        const item = this.pending.shift();
        this.used -= item.length;
        return item.cmd;
    }
    
    clear() {
        this.used = 0;
        this.pending = [];
    }
}

runner.test('Buffer: Add command within limit', () => {
    const buffer = new MockBuffer(128);
    assertTrue(buffer.add('G0 X100'));
    assertEqual(buffer.used, 8); // 7 chars + newline
});

runner.test('Buffer: Reject command exceeding limit', () => {
    const buffer = new MockBuffer(10);
    assertFalse(buffer.add('G0 X100 Y200 Z50'));
});

runner.test('Buffer: Remove command frees space', () => {
    const buffer = new MockBuffer(128);
    buffer.add('G0 X100');
    assertEqual(buffer.used, 8);
    buffer.remove();
    assertEqual(buffer.used, 0);
});

runner.test('Buffer: Multiple commands FIFO order', () => {
    const buffer = new MockBuffer(128);
    buffer.add('G0 X10');
    buffer.add('G1 Y20');
    buffer.add('G2 Z30');
    
    assertEqual(buffer.remove(), 'G0 X10');
    assertEqual(buffer.remove(), 'G1 Y20');
    assertEqual(buffer.remove(), 'G2 Z30');
});

// ================================================================
// Feeds and Speeds Calculation Tests
// ================================================================

function calculateFeed(rpm, flutes, chipload) {
    return rpm * flutes * chipload;
}

function calculateSurfaceSpeed(rpm, diameter) {
    return (Math.PI * diameter * rpm) / 1000; // m/min
}

runner.test('Feeds: Basic feed rate calculation', () => {
    // 18000 RPM, 2 flutes, 0.04mm chipload
    const feed = calculateFeed(18000, 2, 0.04);
    assertEqual(feed, 1440);
});

runner.test('Feeds: Surface speed calculation', () => {
    // 18000 RPM, 6mm diameter
    const sfm = calculateSurfaceSpeed(18000, 6);
    assertTrue(Math.abs(sfm - 339.29) < 0.1);
});

// ================================================================
// State Persistence Tests
// ================================================================

runner.test('State Persistence: Serialize and deserialize', () => {
    const state = {
        wcs: 'G54',
        wco: { x: 100, y: 50, z: -10 },
        units: 'G21'
    };
    
    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);
    
    assertDeepEqual(deserialized, state);
});

runner.test('State Persistence: Handle null values', () => {
    const state = {
        wcs: 'G54',
        tool: null,
        lastFile: undefined
    };
    
    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);
    
    assertEqual(deserialized.wcs, 'G54');
    assertEqual(deserialized.tool, null);
    assertTrue(deserialized.lastFile === undefined);
});

// ================================================================
// Offline Queue Tests
// ================================================================

class MockOfflineQueue {
    constructor(maxSize = 100) {
        this.queue = [];
        this.maxSize = maxSize;
    }
    
    add(cmd) {
        if (this.queue.length >= this.maxSize) {
            this.queue.shift(); // Remove oldest
        }
        this.queue.push({
            command: cmd,
            timestamp: Date.now()
        });
        return this.queue.length;
    }
    
    getAll() {
        return [...this.queue];
    }
    
    clear() {
        const count = this.queue.length;
        this.queue = [];
        return count;
    }
}

runner.test('Offline Queue: Add commands', () => {
    const queue = new MockOfflineQueue();
    queue.add('G0 X100');
    queue.add('G1 Y50');
    
    assertEqual(queue.getAll().length, 2);
});

runner.test('Offline Queue: Max size limit', () => {
    const queue = new MockOfflineQueue(3);
    queue.add('cmd1');
    queue.add('cmd2');
    queue.add('cmd3');
    queue.add('cmd4'); // Should drop cmd1
    
    const items = queue.getAll();
    assertEqual(items.length, 3);
    assertEqual(items[0].command, 'cmd2');
});

runner.test('Offline Queue: Clear all', () => {
    const queue = new MockOfflineQueue();
    queue.add('G0 X100');
    queue.add('G1 Y50');
    
    const cleared = queue.clear();
    assertEqual(cleared, 2);
    assertEqual(queue.getAll().length, 0);
});

// ================================================================
// Coordinate Parsing Tests
// ================================================================

function parseCoordinates(text) {
    const coords = {};
    const xMatch = text.match(/[Xx]\s*([\d.\-]+)/);
    const yMatch = text.match(/[Yy]\s*([\d.\-]+)/);
    const zMatch = text.match(/[Zz]\s*([\d.\-]+)/);
    
    if (xMatch) coords.x = parseFloat(xMatch[1]);
    if (yMatch) coords.y = parseFloat(yMatch[1]);
    if (zMatch) coords.z = parseFloat(zMatch[1]);
    
    return coords;
}

runner.test('Coordinates: Parse all axes', () => {
    const coords = parseCoordinates('X10 Y20 Z-5');
    assertDeepEqual(coords, { x: 10, y: 20, z: -5 });
});

runner.test('Coordinates: Parse partial axes', () => {
    const coords = parseCoordinates('X10 Z-5');
    assertDeepEqual(coords, { x: 10, z: -5 });
});

runner.test('Coordinates: Handle decimals', () => {
    const coords = parseCoordinates('X10.5 Y20.125 Z-0.5');
    assertDeepEqual(coords, { x: 10.5, y: 20.125, z: -0.5 });
});

// ================================================================
// Run Tests
// ================================================================

async function runTests() {
    return await runner.run();
}

// Auto-run if in Node.js
if (typeof module !== 'undefined' && require.main === module) {
    runTests().then(results => {
        process.exit(results.failed > 0 ? 1 : 0);
    });
}

// Export for browser/module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runTests, TestRunner };
}

// Make available globally for browser
if (typeof window !== 'undefined') {
    window.runFluidCNCTests = runTests;
}
