/* ========================================
   FluidCNC - DXF/SVG Import & G-code Generator
   Converts vector files to CNC toolpaths
   ======================================== */

class VectorImporter {
    constructor(options = {}) {
        this.config = {
            // Default cutting parameters
            feedRate: options.feedRate || 1000,           // mm/min
            plungeRate: options.plungeRate || 300,        // mm/min
            cutDepth: options.cutDepth || 3,              // mm
            depthPerPass: options.depthPerPass || 1,      // mm
            safeZ: options.safeZ || 5,                    // mm
            tabHeight: options.tabHeight || 1,            // mm for holding tabs
            tabWidth: options.tabWidth || 5,              // mm
            
            // Tool settings
            toolDiameter: options.toolDiameter || 3.175,  // mm (1/8")
            toolOffset: options.toolOffset || 'outside',  // 'inside', 'outside', 'none'
            
            // Unit handling
            defaultUnit: options.defaultUnit || 'mm',      // 'mm' or 'in'
            
            // Arc handling
            arcResolution: options.arcResolution || 0.1,   // mm for arc linearization
            useArcs: options.useArcs ?? true               // Output G2/G3 or linearize
        };
        
        // Parsed geometry
        this.paths = [];
        this.bounds = null;
    }
    
    // ================================================================
    // File Detection & Loading
    // ================================================================
    
    /**
     * Detect file type and parse
     */
    async loadFile(file) {
        const ext = file.name.toLowerCase().split('.').pop();
        const text = await file.text();
        
        if (ext === 'svg') {
            return this.parseSVG(text);
        } else if (ext === 'dxf') {
            return this.parseDXF(text);
        } else {
            throw new Error(`Unsupported file type: ${ext}`);
        }
    }
    
    /**
     * Load from text with explicit type
     */
    loadText(text, type) {
        if (type === 'svg') {
            return this.parseSVG(text);
        } else if (type === 'dxf') {
            return this.parseDXF(text);
        } else {
            throw new Error(`Unsupported type: ${type}`);
        }
    }
    
    // ================================================================
    // SVG Parser
    // ================================================================
    
    parseSVG(svgText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const svg = doc.querySelector('svg');
        
        if (!svg) {
            throw new Error('Invalid SVG file');
        }
        
        this.paths = [];
        
        // Get viewBox for scaling
        const viewBox = svg.getAttribute('viewBox')?.split(/\s+/).map(parseFloat);
        const width = parseFloat(svg.getAttribute('width')) || viewBox?.[2] || 100;
        const height = parseFloat(svg.getAttribute('height')) || viewBox?.[3] || 100;
        
        // Detect units from width/height attributes
        const widthAttr = svg.getAttribute('width') || '';
        const unitMatch = widthAttr.match(/(mm|in|cm|pt|px)/);
        const sourceUnit = unitMatch?.[1] || 'px';
        
        // Unit conversion to mm
        const unitScale = this.getUnitScale(sourceUnit);
        
        // Parse all path elements
        this.parseElement(svg, [[1, 0, 0, 1, 0, 0]], unitScale);
        
        // Calculate bounds
        this.calculateBounds();
        
        return {
            paths: this.paths,
            bounds: this.bounds,
            sourceUnit,
            width: width * unitScale,
            height: height * unitScale
        };
    }
    
    getUnitScale(unit) {
        switch (unit) {
            case 'mm': return 1;
            case 'cm': return 10;
            case 'in': return 25.4;
            case 'pt': return 25.4 / 72;
            case 'px': return 25.4 / 96; // Assuming 96 DPI
            default: return 1;
        }
    }
    
    parseElement(element, transforms, unitScale) {
        // Get local transform
        const localTransform = this.parseTransform(element.getAttribute('transform'));
        const currentTransform = this.multiplyTransforms(
            transforms[transforms.length - 1],
            localTransform
        );
        transforms.push(currentTransform);
        
        // Process based on element type
        const tag = element.tagName.toLowerCase();
        
        switch (tag) {
            case 'path':
                this.parsePath(element.getAttribute('d'), currentTransform, unitScale);
                break;
            case 'line':
                this.parseLine(element, currentTransform, unitScale);
                break;
            case 'rect':
                this.parseRect(element, currentTransform, unitScale);
                break;
            case 'circle':
                this.parseCircle(element, currentTransform, unitScale);
                break;
            case 'ellipse':
                this.parseEllipse(element, currentTransform, unitScale);
                break;
            case 'polygon':
                this.parsePolygon(element, currentTransform, unitScale);
                break;
            case 'polyline':
                this.parsePolyline(element, currentTransform, unitScale);
                break;
        }
        
        // Process children
        for (const child of element.children) {
            this.parseElement(child, transforms, unitScale);
        }
        
        transforms.pop();
    }
    
    parsePath(d, transform, unitScale) {
        if (!d) return;
        
        const commands = this.tokenizePathData(d);
        const path = { type: 'path', segments: [], closed: false };
        
        let x = 0, y = 0;
        let startX = 0, startY = 0;
        let cpx = 0, cpy = 0;
        
        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];
            const type = cmd.type;
            const args = cmd.args;
            const relative = type === type.toLowerCase();
            
            switch (type.toUpperCase()) {
                case 'M':
                    if (relative) {
                        x += args[0];
                        y += args[1];
                    } else {
                        x = args[0];
                        y = args[1];
                    }
                    startX = x;
                    startY = y;
                    path.segments.push({
                        type: 'move',
                        ...this.transformPoint(x * unitScale, y * unitScale, transform)
                    });
                    break;
                    
                case 'L':
                    if (relative) {
                        x += args[0];
                        y += args[1];
                    } else {
                        x = args[0];
                        y = args[1];
                    }
                    path.segments.push({
                        type: 'line',
                        ...this.transformPoint(x * unitScale, y * unitScale, transform)
                    });
                    break;
                    
                case 'H':
                    x = relative ? x + args[0] : args[0];
                    path.segments.push({
                        type: 'line',
                        ...this.transformPoint(x * unitScale, y * unitScale, transform)
                    });
                    break;
                    
                case 'V':
                    y = relative ? y + args[0] : args[0];
                    path.segments.push({
                        type: 'line',
                        ...this.transformPoint(x * unitScale, y * unitScale, transform)
                    });
                    break;
                    
                case 'C':
                    {
                        let cp1x, cp1y, cp2x, cp2y, ex, ey;
                        if (relative) {
                            cp1x = x + args[0]; cp1y = y + args[1];
                            cp2x = x + args[2]; cp2y = y + args[3];
                            ex = x + args[4]; ey = y + args[5];
                        } else {
                            cp1x = args[0]; cp1y = args[1];
                            cp2x = args[2]; cp2y = args[3];
                            ex = args[4]; ey = args[5];
                        }
                        
                        // Linearize cubic bezier
                        const pts = this.linearizeCubicBezier(
                            x * unitScale, y * unitScale,
                            cp1x * unitScale, cp1y * unitScale,
                            cp2x * unitScale, cp2y * unitScale,
                            ex * unitScale, ey * unitScale,
                            transform
                        );
                        
                        pts.forEach(pt => path.segments.push({ type: 'line', ...pt }));
                        
                        x = ex; y = ey;
                        cpx = cp2x; cpy = cp2y;
                    }
                    break;
                    
                case 'Q':
                    {
                        let qcx, qcy, qex, qey;
                        if (relative) {
                            qcx = x + args[0]; qcy = y + args[1];
                            qex = x + args[2]; qey = y + args[3];
                        } else {
                            qcx = args[0]; qcy = args[1];
                            qex = args[2]; qey = args[3];
                        }
                        
                        // Linearize quadratic bezier
                        const pts = this.linearizeQuadraticBezier(
                            x * unitScale, y * unitScale,
                            qcx * unitScale, qcy * unitScale,
                            qex * unitScale, qey * unitScale,
                            transform
                        );
                        
                        pts.forEach(pt => path.segments.push({ type: 'line', ...pt }));
                        
                        x = qex; y = qey;
                        cpx = qcx; cpy = qcy;
                    }
                    break;
                    
                case 'A':
                    {
                        const rx = args[0] * unitScale;
                        const ry = args[1] * unitScale;
                        const rotation = args[2] * Math.PI / 180;
                        const largeArc = args[3];
                        const sweep = args[4];
                        let ex, ey;
                        if (relative) {
                            ex = x + args[5];
                            ey = y + args[6];
                        } else {
                            ex = args[5];
                            ey = args[6];
                        }
                        
                        // Linearize arc
                        const pts = this.linearizeArc(
                            x * unitScale, y * unitScale,
                            rx, ry, rotation,
                            largeArc, sweep,
                            ex * unitScale, ey * unitScale,
                            transform
                        );
                        
                        pts.forEach(pt => path.segments.push({ type: 'line', ...pt }));
                        
                        x = ex; y = ey;
                    }
                    break;
                    
                case 'Z':
                    path.closed = true;
                    x = startX;
                    y = startY;
                    break;
            }
        }
        
        if (path.segments.length > 0) {
            this.paths.push(path);
        }
    }
    
    tokenizePathData(d) {
        const commands = [];
        const regex = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
        let match;
        
        while ((match = regex.exec(d)) !== null) {
            const type = match[1];
            const args = match[2]
                .trim()
                .split(/[\s,]+/)
                .filter(s => s)
                .map(parseFloat);
            
            commands.push({ type, args });
        }
        
        return commands;
    }
    
    parseLine(element, transform, unitScale) {
        const x1 = parseFloat(element.getAttribute('x1') || 0) * unitScale;
        const y1 = parseFloat(element.getAttribute('y1') || 0) * unitScale;
        const x2 = parseFloat(element.getAttribute('x2') || 0) * unitScale;
        const y2 = parseFloat(element.getAttribute('y2') || 0) * unitScale;
        
        this.paths.push({
            type: 'line',
            segments: [
                { type: 'move', ...this.transformPoint(x1, y1, transform) },
                { type: 'line', ...this.transformPoint(x2, y2, transform) }
            ],
            closed: false
        });
    }
    
    parseRect(element, transform, unitScale) {
        const x = parseFloat(element.getAttribute('x') || 0) * unitScale;
        const y = parseFloat(element.getAttribute('y') || 0) * unitScale;
        const w = parseFloat(element.getAttribute('width') || 0) * unitScale;
        const h = parseFloat(element.getAttribute('height') || 0) * unitScale;
        const rx = parseFloat(element.getAttribute('rx') || 0) * unitScale;
        const ry = parseFloat(element.getAttribute('ry') || rx) * unitScale;
        
        const path = { type: 'rect', segments: [], closed: true };
        
        if (rx > 0 || ry > 0) {
            // Rounded rect - linearize corners
            const r = Math.min(rx, ry, w / 2, h / 2);
            
            path.segments.push({ type: 'move', ...this.transformPoint(x + r, y, transform) });
            path.segments.push({ type: 'line', ...this.transformPoint(x + w - r, y, transform) });
            
            // Top-right corner
            this.addCornerArc(path, x + w - r, y + r, r, -90, 0, transform);
            
            path.segments.push({ type: 'line', ...this.transformPoint(x + w, y + h - r, transform) });
            
            // Bottom-right corner
            this.addCornerArc(path, x + w - r, y + h - r, r, 0, 90, transform);
            
            path.segments.push({ type: 'line', ...this.transformPoint(x + r, y + h, transform) });
            
            // Bottom-left corner
            this.addCornerArc(path, x + r, y + h - r, r, 90, 180, transform);
            
            path.segments.push({ type: 'line', ...this.transformPoint(x, y + r, transform) });
            
            // Top-left corner
            this.addCornerArc(path, x + r, y + r, r, 180, 270, transform);
        } else {
            path.segments.push({ type: 'move', ...this.transformPoint(x, y, transform) });
            path.segments.push({ type: 'line', ...this.transformPoint(x + w, y, transform) });
            path.segments.push({ type: 'line', ...this.transformPoint(x + w, y + h, transform) });
            path.segments.push({ type: 'line', ...this.transformPoint(x, y + h, transform) });
        }
        
        this.paths.push(path);
    }
    
    parseCircle(element, transform, unitScale) {
        const cx = parseFloat(element.getAttribute('cx') || 0) * unitScale;
        const cy = parseFloat(element.getAttribute('cy') || 0) * unitScale;
        const r = parseFloat(element.getAttribute('r') || 0) * unitScale;
        
        this.paths.push(this.createCirclePath(cx, cy, r, transform));
    }
    
    parseEllipse(element, transform, unitScale) {
        const cx = parseFloat(element.getAttribute('cx') || 0) * unitScale;
        const cy = parseFloat(element.getAttribute('cy') || 0) * unitScale;
        const rx = parseFloat(element.getAttribute('rx') || 0) * unitScale;
        const ry = parseFloat(element.getAttribute('ry') || 0) * unitScale;
        
        this.paths.push(this.createEllipsePath(cx, cy, rx, ry, transform));
    }
    
    parsePolygon(element, transform, unitScale) {
        const points = this.parsePoints(element.getAttribute('points'), unitScale);
        if (points.length < 2) return;
        
        const path = { type: 'polygon', segments: [], closed: true };
        
        path.segments.push({ type: 'move', ...this.transformPoint(points[0].x, points[0].y, transform) });
        for (let i = 1; i < points.length; i++) {
            path.segments.push({ type: 'line', ...this.transformPoint(points[i].x, points[i].y, transform) });
        }
        
        this.paths.push(path);
    }
    
    parsePolyline(element, transform, unitScale) {
        const points = this.parsePoints(element.getAttribute('points'), unitScale);
        if (points.length < 2) return;
        
        const path = { type: 'polyline', segments: [], closed: false };
        
        path.segments.push({ type: 'move', ...this.transformPoint(points[0].x, points[0].y, transform) });
        for (let i = 1; i < points.length; i++) {
            path.segments.push({ type: 'line', ...this.transformPoint(points[i].x, points[i].y, transform) });
        }
        
        this.paths.push(path);
    }
    
    parsePoints(pointsStr, unitScale) {
        if (!pointsStr) return [];
        
        const nums = pointsStr.trim().split(/[\s,]+/).map(parseFloat);
        const points = [];
        
        for (let i = 0; i < nums.length - 1; i += 2) {
            points.push({ x: nums[i] * unitScale, y: nums[i + 1] * unitScale });
        }
        
        return points;
    }
    
    createCirclePath(cx, cy, r, transform) {
        const path = { type: 'circle', segments: [], closed: true };
        const steps = Math.max(12, Math.ceil(2 * Math.PI * r / this.config.arcResolution));
        
        for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * 2 * Math.PI;
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            
            path.segments.push({
                type: i === 0 ? 'move' : 'line',
                ...this.transformPoint(x, y, transform)
            });
        }
        
        return path;
    }
    
    createEllipsePath(cx, cy, rx, ry, transform) {
        const path = { type: 'ellipse', segments: [], closed: true };
        const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
        const steps = Math.max(12, Math.ceil(perimeter / this.config.arcResolution));
        
        for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * 2 * Math.PI;
            const x = cx + rx * Math.cos(angle);
            const y = cy + ry * Math.sin(angle);
            
            path.segments.push({
                type: i === 0 ? 'move' : 'line',
                ...this.transformPoint(x, y, transform)
            });
        }
        
        return path;
    }
    
    addCornerArc(path, cx, cy, r, startAngle, endAngle, transform) {
        const startRad = startAngle * Math.PI / 180;
        const endRad = endAngle * Math.PI / 180;
        const arcLength = Math.abs(endRad - startRad) * r;
        const steps = Math.max(4, Math.ceil(arcLength / this.config.arcResolution));
        
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const angle = startRad + (endRad - startRad) * t;
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            
            path.segments.push({ type: 'line', ...this.transformPoint(x, y, transform) });
        }
    }
    
    // ================================================================
    // DXF Parser (Simplified)
    // ================================================================
    
    parseDXF(dxfText) {
        this.paths = [];
        
        // Parse DXF entities
        const entities = this.extractDXFEntities(dxfText);
        
        for (const entity of entities) {
            switch (entity.type) {
                case 'LINE':
                    this.paths.push({
                        type: 'line',
                        segments: [
                            { type: 'move', x: entity.x1, y: entity.y1 },
                            { type: 'line', x: entity.x2, y: entity.y2 }
                        ],
                        closed: false
                    });
                    break;
                    
                case 'CIRCLE':
                    this.paths.push(this.createCirclePath(
                        entity.cx, entity.cy, entity.r,
                        [1, 0, 0, 1, 0, 0]
                    ));
                    break;
                    
                case 'ARC':
                    {
                        const path = { type: 'arc', segments: [], closed: false };
                        const startRad = entity.startAngle * Math.PI / 180;
                        const endRad = entity.endAngle * Math.PI / 180;
                        
                        let deltaAngle = endRad - startRad;
                        if (deltaAngle < 0) deltaAngle += 2 * Math.PI;
                        
                        const arcLength = deltaAngle * entity.r;
                        const steps = Math.max(8, Math.ceil(arcLength / this.config.arcResolution));
                        
                        for (let i = 0; i <= steps; i++) {
                            const t = i / steps;
                            const angle = startRad + deltaAngle * t;
                            const x = entity.cx + entity.r * Math.cos(angle);
                            const y = entity.cy + entity.r * Math.sin(angle);
                            
                            path.segments.push({
                                type: i === 0 ? 'move' : 'line',
                                x, y
                            });
                        }
                        
                        this.paths.push(path);
                    }
                    break;
                    
                case 'LWPOLYLINE':
                case 'POLYLINE':
                    if (entity.vertices?.length > 1) {
                        const path = { type: 'polyline', segments: [], closed: entity.closed };
                        
                        path.segments.push({ type: 'move', x: entity.vertices[0].x, y: entity.vertices[0].y });
                        for (let i = 1; i < entity.vertices.length; i++) {
                            path.segments.push({ type: 'line', x: entity.vertices[i].x, y: entity.vertices[i].y });
                        }
                        
                        this.paths.push(path);
                    }
                    break;
            }
        }
        
        this.calculateBounds();
        
        return {
            paths: this.paths,
            bounds: this.bounds
        };
    }
    
    extractDXFEntities(text) {
        const entities = [];
        const lines = text.split('\n').map(l => l.trim());
        
        let i = 0;
        let currentEntity = null;
        let inEntitiesSection = false;
        
        while (i < lines.length - 1) {
            const code = parseInt(lines[i]);
            const value = lines[i + 1];
            
            if (code === 0) {
                if (value === 'ENTITIES') {
                    inEntitiesSection = true;
                } else if (value === 'ENDSEC') {
                    inEntitiesSection = false;
                } else if (inEntitiesSection) {
                    if (currentEntity) {
                        entities.push(currentEntity);
                    }
                    currentEntity = { type: value };
                }
            } else if (currentEntity && inEntitiesSection) {
                this.parseDXFCode(currentEntity, code, value);
            }
            
            i += 2;
        }
        
        if (currentEntity) {
            entities.push(currentEntity);
        }
        
        return entities;
    }
    
    parseDXFCode(entity, code, value) {
        const num = parseFloat(value);
        
        switch (entity.type) {
            case 'LINE':
                if (code === 10) entity.x1 = num;
                if (code === 20) entity.y1 = num;
                if (code === 11) entity.x2 = num;
                if (code === 21) entity.y2 = num;
                break;
                
            case 'CIRCLE':
            case 'ARC':
                if (code === 10) entity.cx = num;
                if (code === 20) entity.cy = num;
                if (code === 40) entity.r = num;
                if (code === 50) entity.startAngle = num;
                if (code === 51) entity.endAngle = num;
                break;
                
            case 'LWPOLYLINE':
            case 'POLYLINE':
                if (code === 70) entity.closed = (num & 1) === 1;
                if (code === 10) {
                    if (!entity.vertices) entity.vertices = [];
                    entity.vertices.push({ x: num, y: 0 });
                }
                if (code === 20 && entity.vertices?.length > 0) {
                    entity.vertices[entity.vertices.length - 1].y = num;
                }
                break;
        }
    }
    
    // ================================================================
    // Transform Utilities
    // ================================================================
    
    parseTransform(transformStr) {
        if (!transformStr) return [1, 0, 0, 1, 0, 0];
        
        let matrix = [1, 0, 0, 1, 0, 0];
        
        const transforms = transformStr.match(/\w+\([^)]+\)/g) || [];
        
        for (const t of transforms) {
            const [, name, args] = t.match(/(\w+)\(([^)]+)\)/) || [];
            const nums = args?.split(/[\s,]+/).map(parseFloat) || [];
            
            switch (name) {
                case 'translate':
                    matrix = this.multiplyTransforms(matrix, [1, 0, 0, 1, nums[0] || 0, nums[1] || 0]);
                    break;
                case 'scale':
                    matrix = this.multiplyTransforms(matrix, [nums[0] || 1, 0, 0, nums[1] || nums[0] || 1, 0, 0]);
                    break;
                case 'rotate':
                    const rad = (nums[0] || 0) * Math.PI / 180;
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    if (nums.length >= 3) {
                        const cx = nums[1], cy = nums[2];
                        matrix = this.multiplyTransforms(matrix, [1, 0, 0, 1, cx, cy]);
                        matrix = this.multiplyTransforms(matrix, [cos, sin, -sin, cos, 0, 0]);
                        matrix = this.multiplyTransforms(matrix, [1, 0, 0, 1, -cx, -cy]);
                    } else {
                        matrix = this.multiplyTransforms(matrix, [cos, sin, -sin, cos, 0, 0]);
                    }
                    break;
                case 'matrix':
                    matrix = this.multiplyTransforms(matrix, nums);
                    break;
            }
        }
        
        return matrix;
    }
    
    multiplyTransforms(a, b) {
        return [
            a[0] * b[0] + a[2] * b[1],
            a[1] * b[0] + a[3] * b[1],
            a[0] * b[2] + a[2] * b[3],
            a[1] * b[2] + a[3] * b[3],
            a[0] * b[4] + a[2] * b[5] + a[4],
            a[1] * b[4] + a[3] * b[5] + a[5]
        ];
    }
    
    transformPoint(x, y, transform) {
        return {
            x: transform[0] * x + transform[2] * y + transform[4],
            y: transform[1] * x + transform[3] * y + transform[5]
        };
    }
    
    // ================================================================
    // Curve Linearization
    // ================================================================
    
    linearizeCubicBezier(x0, y0, cp1x, cp1y, cp2x, cp2y, x1, y1, transform) {
        const points = [];
        const length = this.estimateCubicBezierLength(x0, y0, cp1x, cp1y, cp2x, cp2y, x1, y1);
        const steps = Math.max(4, Math.ceil(length / this.config.arcResolution));
        
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const tt = t * t;
            const ttt = tt * t;
            const u = 1 - t;
            const uu = u * u;
            const uuu = uu * u;
            
            const x = uuu * x0 + 3 * uu * t * cp1x + 3 * u * tt * cp2x + ttt * x1;
            const y = uuu * y0 + 3 * uu * t * cp1y + 3 * u * tt * cp2y + ttt * y1;
            
            points.push(this.transformPoint(x, y, transform));
        }
        
        return points;
    }
    
    linearizeQuadraticBezier(x0, y0, cpx, cpy, x1, y1, transform) {
        const points = [];
        const length = this.estimateQuadraticBezierLength(x0, y0, cpx, cpy, x1, y1);
        const steps = Math.max(4, Math.ceil(length / this.config.arcResolution));
        
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const u = 1 - t;
            
            const x = u * u * x0 + 2 * u * t * cpx + t * t * x1;
            const y = u * u * y0 + 2 * u * t * cpy + t * t * y1;
            
            points.push(this.transformPoint(x, y, transform));
        }
        
        return points;
    }
    
    linearizeArc(x0, y0, rx, ry, rotation, largeArc, sweep, x1, y1, transform) {
        // SVG arc to center parameterization
        const points = [];
        
        // Skip degenerate arcs
        if (x0 === x1 && y0 === y1) return points;
        if (rx === 0 || ry === 0) {
            points.push(this.transformPoint(x1, y1, transform));
            return points;
        }
        
        // Compute center and angles
        const cosR = Math.cos(rotation);
        const sinR = Math.sin(rotation);
        
        const dx = (x0 - x1) / 2;
        const dy = (y0 - y1) / 2;
        
        const x1p = cosR * dx + sinR * dy;
        const y1p = -sinR * dx + cosR * dy;
        
        let rxSq = rx * rx;
        let rySq = ry * ry;
        const x1pSq = x1p * x1p;
        const y1pSq = y1p * y1p;
        
        // Correct radii
        const lambda = x1pSq / rxSq + y1pSq / rySq;
        if (lambda > 1) {
            const lambdaSqrt = Math.sqrt(lambda);
            rx *= lambdaSqrt;
            ry *= lambdaSqrt;
            rxSq = rx * rx;
            rySq = ry * ry;
        }
        
        const sq = Math.max(0, (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq));
        const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(sq);
        const cxp = coef * rx * y1p / ry;
        const cyp = coef * -ry * x1p / rx;
        
        const cx = cosR * cxp - sinR * cyp + (x0 + x1) / 2;
        const cy = sinR * cxp + cosR * cyp + (y0 + y1) / 2;
        
        const startAngle = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
        let deltaAngle = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - startAngle;
        
        if (sweep && deltaAngle < 0) deltaAngle += 2 * Math.PI;
        if (!sweep && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
        
        const arcLength = Math.abs(deltaAngle) * Math.max(rx, ry);
        const steps = Math.max(4, Math.ceil(arcLength / this.config.arcResolution));
        
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const angle = startAngle + deltaAngle * t;
            
            const xp = rx * Math.cos(angle);
            const yp = ry * Math.sin(angle);
            
            const x = cosR * xp - sinR * yp + cx;
            const y = sinR * xp + cosR * yp + cy;
            
            points.push(this.transformPoint(x, y, transform));
        }
        
        return points;
    }
    
    estimateCubicBezierLength(x0, y0, cp1x, cp1y, cp2x, cp2y, x1, y1) {
        // Rough estimation using chord and control polygon
        const chord = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
        const controlPoly = 
            Math.sqrt((cp1x - x0) ** 2 + (cp1y - y0) ** 2) +
            Math.sqrt((cp2x - cp1x) ** 2 + (cp2y - cp1y) ** 2) +
            Math.sqrt((x1 - cp2x) ** 2 + (y1 - cp2y) ** 2);
        return (chord + controlPoly) / 2;
    }
    
    estimateQuadraticBezierLength(x0, y0, cpx, cpy, x1, y1) {
        const chord = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
        const controlPoly = 
            Math.sqrt((cpx - x0) ** 2 + (cpy - y0) ** 2) +
            Math.sqrt((x1 - cpx) ** 2 + (y1 - cpy) ** 2);
        return (chord + controlPoly) / 2;
    }
    
    // ================================================================
    // Bounds Calculation
    // ================================================================
    
    calculateBounds() {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        for (const path of this.paths) {
            for (const seg of path.segments) {
                if (seg.x < minX) minX = seg.x;
                if (seg.y < minY) minY = seg.y;
                if (seg.x > maxX) maxX = seg.x;
                if (seg.y > maxY) maxY = seg.y;
            }
        }
        
        this.bounds = {
            minX, minY, maxX, maxY,
            width: maxX - minX,
            height: maxY - minY
        };
    }
    
    // ================================================================
    // G-code Generation
    // ================================================================
    
    generateGCode(options = {}) {
        const config = { ...this.config, ...options };
        const lines = [];
        
        // Header
        lines.push('; Generated by FluidCNC Vector Importer');
        lines.push(`; Paths: ${this.paths.length}`);
        lines.push(`; Bounds: ${this.bounds.width.toFixed(2)} x ${this.bounds.height.toFixed(2)} mm`);
        lines.push('');
        lines.push('G21 ; Millimeters');
        lines.push('G90 ; Absolute positioning');
        lines.push(`G0 Z${config.safeZ.toFixed(3)} ; Safe height`);
        lines.push('');
        
        // Calculate number of passes
        const numPasses = Math.ceil(config.cutDepth / config.depthPerPass);
        
        for (let pass = 1; pass <= numPasses; pass++) {
            const passDepth = Math.min(pass * config.depthPerPass, config.cutDepth);
            lines.push(`; Pass ${pass}/${numPasses} - Depth: ${passDepth.toFixed(3)} mm`);
            
            for (let pathIdx = 0; pathIdx < this.paths.length; pathIdx++) {
                const path = this.paths[pathIdx];
                
                lines.push(`; Path ${pathIdx + 1}`);
                
                // Apply tool offset if needed
                const offsetPath = config.toolOffset !== 'none' 
                    ? this.offsetPath(path, config.toolDiameter / 2, config.toolOffset === 'outside')
                    : path;
                
                for (let i = 0; i < offsetPath.segments.length; i++) {
                    const seg = offsetPath.segments[i];
                    
                    if (seg.type === 'move') {
                        // Rapid to position
                        lines.push(`G0 X${seg.x.toFixed(3)} Y${seg.y.toFixed(3)}`);
                        // Plunge
                        lines.push(`G1 Z${(-passDepth).toFixed(3)} F${config.plungeRate}`);
                    } else {
                        // Cut move
                        lines.push(`G1 X${seg.x.toFixed(3)} Y${seg.y.toFixed(3)} F${config.feedRate}`);
                    }
                }
                
                // Retract after each path
                lines.push(`G0 Z${config.safeZ.toFixed(3)}`);
                lines.push('');
            }
        }
        
        // Footer
        lines.push('; End of program');
        lines.push(`G0 Z${config.safeZ.toFixed(3)}`);
        lines.push('G0 X0 Y0');
        lines.push('M30');
        
        return lines.join('\n');
    }
    
    /**
     * Simple offset path (basic implementation)
     */
    offsetPath(path, offset, outside) {
        if (path.segments.length < 2) return path;
        
        const sign = outside ? 1 : -1;
        const offsetSegs = [];
        
        for (let i = 0; i < path.segments.length; i++) {
            const seg = path.segments[i];
            const prev = path.segments[(i - 1 + path.segments.length) % path.segments.length];
            const next = path.segments[(i + 1) % path.segments.length];
            
            // Calculate normal at this point
            let dx = 0, dy = 0;
            
            if (i > 0 || path.closed) {
                dx += seg.x - prev.x;
                dy += seg.y - prev.y;
            }
            if (i < path.segments.length - 1 || path.closed) {
                dx += next.x - seg.x;
                dy += next.y - seg.y;
            }
            
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0.001) {
                const nx = -dy / len * sign;
                const ny = dx / len * sign;
                
                offsetSegs.push({
                    type: seg.type,
                    x: seg.x + nx * offset,
                    y: seg.y + ny * offset
                });
            } else {
                offsetSegs.push({ ...seg });
            }
        }
        
        return {
            type: path.type,
            segments: offsetSegs,
            closed: path.closed
        };
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VectorImporter;
}
