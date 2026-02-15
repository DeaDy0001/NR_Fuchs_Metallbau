import { useEffect, useRef, useState, useCallback } from 'react';
import { fabric } from 'fabric';
import {
  X, Save, FileDown, XCircle, Minus, Square, Circle, Type,
  Ruler, MousePointer, Trash2, Edit2, ChevronUp, ChevronDown,
  ArrowRight, Pencil, Eye, EyeOff, ZoomIn, ZoomOut, RotateCcw, Box
} from 'lucide-react';
import './ImageEditor.css';
import {
  computeHomography,
  perspectiveTransform,
  calculateRealDistance,
  isPointInCalibration
} from '../utils/homography';

function ImageEditor({ image, onClose }) {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const [activeTool, setActiveTool] = useState('select');
  const [layers, setLayers] = useState([]);
  const [selectedLayer, setSelectedLayer] = useState(null);
  const [measurementPoints, setMeasurementPoints] = useState([]);
  const [editingLayerId, setEditingLayerId] = useState(null);
  const [editingText, setEditingText] = useState('');

  // Drag drawing state (use ref to avoid useEffect re-runs)
  const dragStartRef = useRef(null);
  const dragStartTimeRef = useRef(null);
  const tempObjectRef = useRef(null);
  const isDrawingRef = useRef(false);
  const [activeFreehandPath, setActiveFreehandPath] = useState(null);

  // Tool colors and settings
  const [strokeColor, setStrokeColor] = useState('#ff0000');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fontSize, setFontSize] = useState(16);

  // Color presets (saved colors for quick access)
  const [colorPresets, setColorPresets] = useState([]);
  const NUM_COLOR_SLOTS = 6;

  // 3D Measurement reference rectangle state
  const referenceObjectsRef = useRef([]); // All reference objects (rect, points, icon)
  const threeDMeasurementsRef = useRef([]); // All 3D measurements for live updates
  const [referenceWidth, setReferenceWidth] = useState(100); // cm
  const [referenceHeight, setReferenceHeight] = useState(50); // cm
  const [referenceUnit, setReferenceUnit] = useState('cm');
  const [has3DReference, setHas3DReference] = useState(false);
  const [referenceCollapsed, setReferenceCollapsed] = useState(false);

  // Measurement editing handles
  const measurementHandlesRef = useRef([]);

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    // Get container dimensions
    const container = containerRef.current;
    const width = container.clientWidth - 40; // Subtract padding
    const height = container.clientHeight - 40;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: width,
      height: height,
      backgroundColor: '#1a1a1a'
    });

    fabricCanvasRef.current = canvas;

    // Load background image
    fabric.Image.fromURL(image.local_path || image.thumbnail_url, (img) => {
      const scale = Math.min(
        canvas.width / img.width,
        canvas.height / img.height
      );

      img.set({
        scaleX: scale,
        scaleY: scale,
        left: (canvas.width - img.width * scale) / 2,
        top: (canvas.height - img.height * scale) / 2,
        selectable: false,
        evented: false
      });

      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
    });

    // Pan with Shift + Drag
    let isPanning = false;
    let lastPosX = 0;
    let lastPosY = 0;

    canvas.on('mouse:down', function(opt) {
      const evt = opt.e;
      if (evt.shiftKey) {
        isPanning = true;
        canvas.selection = false;
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
        canvas.setCursor('grab');
      }
    });

    canvas.on('mouse:move', function(opt) {
      if (isPanning) {
        const evt = opt.e;
        const deltaX = evt.clientX - lastPosX;
        const deltaY = evt.clientY - lastPosY;

        canvas.relativePan({ x: deltaX, y: deltaY });

        lastPosX = evt.clientX;
        lastPosY = evt.clientY;

        canvas.setCursor('grabbing');
        canvas.renderAll();
      }
    });

    canvas.on('mouse:up', function() {
      if (isPanning) {
        isPanning = false;
        canvas.selection = activeTool === 'select';
        canvas.setCursor('default');
      }
    });

    // Object events
    canvas.on('object:added', updateLayers);
    canvas.on('object:removed', updateLayers);
    canvas.on('object:modified', updateLayers);
    canvas.on('selection:created', handleSelection);
    canvas.on('selection:updated', handleSelection);
    canvas.on('selection:cleared', () => {
      setSelectedLayer(null);
      // Clear active freehand path when deselected
      if (activeTool === 'freehand') {
        setActiveFreehandPath(null);
      }
      // Remove measurement handles when deselected
      removeMeasurementHandles();
    });

    return () => {
      canvas.dispose();
    };
  }, [image]);

  // Update layers when 3D reference changes
  useEffect(() => {
    updateLayers();
  }, [has3DReference]);

  // Load existing annotations
  useEffect(() => {
    const loadAnnotations = async () => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || !image.id) return;

      try {
        const response = await fetch(`/api/annotations/${image.id}`);
        if (response.ok) {
          const data = await response.json();
          if (data.annotations) {
            const annotationsData = typeof data.annotations === 'string'
              ? JSON.parse(data.annotations)
              : data.annotations;

            // Load 3D reference data if exists
            if (annotationsData.referenceData) {
              setReferenceWidth(annotationsData.referenceData.width || 100);
              setReferenceHeight(annotationsData.referenceData.height || 50);
              setReferenceUnit(annotationsData.referenceData.unit || 'cm');
              // Create reference rectangle after loading
              setTimeout(() => createReferenceRectangle(), 100);
            }

            // Load canvas objects
            canvas.loadFromJSON(annotationsData, () => {
              canvas.renderAll();
              updateLayers();

              // Collect 3D measurements for live updates
              const objects = canvas.getObjects();
              objects.forEach(obj => {
                if (obj.customType === '3d-measurement') {
                  threeDMeasurementsRef.current.push({
                    group: obj,
                    startX: obj.measurementStart?.x,
                    startY: obj.measurementStart?.y,
                    endX: obj.measurementEnd?.x,
                    endY: obj.measurementEnd?.y,
                    realDistance: obj.realDistance,
                    unit: obj.unit
                  });
                }
              });
            });
          }
        }
      } catch (error) {
        console.error('Error loading annotations:', error);
      }
    };

    // Wait for canvas to be ready
    const timer = setTimeout(loadAnnotations, 1000);
    return () => clearTimeout(timer);
  }, [image.id]);

  // Update layers list
  const updateLayers = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const allObjects = canvas.getObjects();

    // Filter out reference objects AND measurement handles
    const visibleObjects = allObjects.filter(obj => !obj.referenceObject && !obj.measurementHandle);

    const objects = visibleObjects.map((obj, index) => ({
      id: obj.id || `layer-${index}`,
      type: obj.customType || obj.type,
      name: obj.customName || `${obj.type} ${index + 1}`,
      object: obj
    }));

    // Add 3D reference layer if reference objects exist
    // Check referenceObjectsRef instead of has3DReference state for immediate update
    if (referenceObjectsRef.current.length > 0) {
      objects.unshift({
        id: '3d-reference',
        type: '3d-reference',
        name: '3D Bemaßung',
        object: null, // special layer without canvas object
        isReferenceLayer: true
      });
    }

    setLayers(objects);
  };

  // Handle selection
  const handleSelection = (e) => {
    const obj = e.selected ? e.selected[0] : e.target;
    if (obj) {
      // Skip if selecting a measurement handle
      if (obj.measurementHandle) {
        return;
      }

      // Find the layer ID by matching the object
      const layer = layers.find(l => l.object === obj);
      if (layer) {
        setSelectedLayer(layer.id);
      }

      // If it's a measurement, create draggable handles
      if (obj.customType === 'measurement' || obj.customType === '3d-measurement') {
        createMeasurementHandles(obj);
      } else {
        removeMeasurementHandles();
      }
    }
  };

  // Load color presets from backend
  useEffect(() => {
    const loadColorPresets = async () => {
      try {
        const response = await fetch('/api/color-presets');
        if (response.ok) {
          const presets = await response.json();
          setColorPresets(presets);
        }
      } catch (error) {
        console.error('Error loading color presets:', error);
      }
    };
    loadColorPresets();
  }, []);

  // Save color preset to backend
  const saveColorPreset = async (color, position) => {
    try {
      const response = await fetch('/api/color-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color, position })
      });
      if (response.ok) {
        // Reload presets
        const presetsResponse = await fetch('/api/color-presets');
        if (presetsResponse.ok) {
          const presets = await presetsResponse.json();
          setColorPresets(presets);
        }
      }
    } catch (error) {
      console.error('Error saving color preset:', error);
    }
  };

  // Create 3D reference rectangle with draggable corners
  const createReferenceRectangle = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Remove existing reference if any
    referenceObjectsRef.current.forEach(obj => canvas.remove(obj));
    referenceObjectsRef.current = [];

    // Calculate canvas center
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Visual size (pixels) - proportional to real size
    const visualWidth = 200;
    const visualHeight = (referenceHeight / referenceWidth) * visualWidth;

    // Initial corner positions (rectangle)
    const cornerPositions = [
      { x: centerX - visualWidth / 2, y: centerY - visualHeight / 2, corner: 'tl' }, // top-left
      { x: centerX + visualWidth / 2, y: centerY - visualHeight / 2, corner: 'tr' }, // top-right
      { x: centerX + visualWidth / 2, y: centerY + visualHeight / 2, corner: 'br' }, // bottom-right
      { x: centerX - visualWidth / 2, y: centerY + visualHeight / 2, corner: 'bl' }  // bottom-left
    ];

    // Create 4 corner points (draggable) - outer ring + inner dot
    const corners = [];
    const cornerDots = []; // Inner solid dots

    cornerPositions.forEach((pos, idx) => {
      // Outer circle (transparent fill, solid stroke)
      const outerCircle = new fabric.Circle({
        left: pos.x,
        top: pos.y,
        radius: 8,
        fill: 'rgba(0, 255, 255, 0.2)',
        stroke: '#00ffff',
        strokeWidth: 2,
        originX: 'center',
        originY: 'center',
        selectable: true,
        hasControls: false,
        hasBorders: false,
        referenceObject: true,
        objectType: 'referencePoint',
        cornerIndex: idx,
        cornerType: pos.corner
      });

      // Inner dot (solid, non-selectable, follows outer circle)
      const innerDot = new fabric.Circle({
        left: pos.x,
        top: pos.y,
        radius: 2,
        fill: '#00ffff',
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        referenceObject: true,
        objectType: 'referencePointDot',
        parentCornerIndex: idx
      });

      // Hover effect
      outerCircle.on('mouseover', function() {
        this.set('fill', 'rgba(0, 255, 0, 0.2)', 'stroke', '#00ff00');
        innerDot.set('fill', '#00ff00');
        canvas.renderAll();
      });

      outerCircle.on('mouseout', function() {
        this.set('fill', 'rgba(0, 255, 255, 0.2)', 'stroke', '#00ffff');
        innerDot.set('fill', '#00ffff');
        canvas.renderAll();
      });

      // Update on move - also move inner dot
      outerCircle.on('moving', function() {
        innerDot.set({ left: this.left, top: this.top });
        updateReferenceRectangle();
      });

      outerCircle.on('modified', function() {
        updateAll3DMeasurements();
      });

      corners.push(outerCircle);
      cornerDots.push(innerDot);
    });

    // Create 4 lines connecting the corners (perspective quadrilateral)
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const start = cornerPositions[i];
      const end = cornerPositions[(i + 1) % 4];

      const line = new fabric.Line([start.x, start.y, end.x, end.y], {
        stroke: '#00ffff',
        strokeWidth: 1,
        opacity: 0.5,
        selectable: false,
        evented: false,
        referenceObject: true,
        objectType: 'referenceLine',
        lineIndex: i
      });

      lines.push(line);
    }

    // Create "TOP" icon as polygon (perspective-aware)
    const iconSize = 15;
    const topIconPoly = new fabric.Polygon([
      { x: centerX, y: centerY - iconSize },
      { x: centerX - iconSize * 0.6, y: centerY + iconSize * 0.5 },
      { x: centerX + iconSize * 0.6, y: centerY + iconSize * 0.5 }
    ], {
      fill: '#ffff00',
      stroke: '#ffffff',
      strokeWidth: 1,
      selectable: false,
      evented: false,
      referenceObject: true,
      objectType: 'topIcon'
    });

    const topLabel = new fabric.Text('OBEN', {
      left: centerX,
      top: centerY + iconSize + 8,
      fontSize: 12,
      fill: '#ffff00',
      stroke: '#000000',
      strokeWidth: 0.5,
      fontWeight: 'bold',
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      referenceObject: true,
      objectType: 'topLabel'
    });

    // Add all to canvas
    lines.forEach(line => canvas.add(line));
    corners.forEach(c => canvas.add(c));
    cornerDots.forEach(dot => canvas.add(dot));
    canvas.add(topIconPoly);
    canvas.add(topLabel);

    // Store references: [line0-3, corner0-3, cornerDot0-3, icon, label]
    referenceObjectsRef.current = [...lines, ...corners, ...cornerDots, topIconPoly, topLabel];

    setHas3DReference(true);
    canvas.renderAll();
    updateLayers(); // Force layer update
  }, [referenceWidth, referenceHeight]);

  // Update rectangle shape when corners are moved
  const updateReferenceRectangle = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || referenceObjectsRef.current.length === 0) return;

    const lines = referenceObjectsRef.current.slice(0, 4);
    const corners = referenceObjectsRef.current.slice(4, 8);
    const cornerDots = referenceObjectsRef.current.slice(8, 12);
    const topIconPoly = referenceObjectsRef.current[12];
    const topLabel = referenceObjectsRef.current[13];

    // Get corner positions
    const positions = corners.map(c => ({ x: c.left, y: c.top }));

    // Update lines to connect corners
    for (let i = 0; i < 4; i++) {
      const start = positions[i];
      const end = positions[(i + 1) % 4];

      lines[i].set({
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y
      });
    }

    // Calculate perspective center (intersection of diagonals)
    // Diagonal 1: corners[0] to corners[2]
    // Diagonal 2: corners[1] to corners[3]
    const centerX = (positions[0].x + positions[1].x + positions[2].x + positions[3].x) / 4;
    const centerY = (positions[0].y + positions[1].y + positions[2].y + positions[3].y) / 4;

    // Update TOP icon polygon to fit perspective
    const iconSize = 15;

    // Calculate top edge midpoint (for icon orientation)
    const topMidX = (positions[0].x + positions[1].x) / 2;
    const topMidY = (positions[0].y + positions[1].y) / 2;

    // Create triangle pointing towards top edge
    const dx = topMidX - centerX;
    const dy = topMidY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const scale = iconSize / (dist || 1);

    topIconPoly.set({
      points: [
        { x: centerX + dx * scale * 0.8, y: centerY + dy * scale * 0.8 },
        { x: centerX - dy * scale * 0.4, y: centerY + dx * scale * 0.4 },
        { x: centerX + dy * scale * 0.4, y: centerY - dx * scale * 0.4 }
      ]
    });

    topLabel.set({
      left: centerX,
      top: centerY + iconSize + 8
    });

    canvas.renderAll();
  };

  // Update all 3D measurements when reference changes
  const updateAll3DMeasurements = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || referenceObjectsRef.current.length === 0) return;

    threeDMeasurementsRef.current.forEach(measurement => {
      recalculate3DMeasurement(measurement);
    });
  };

  // Recalculate a single 3D measurement
  const recalculate3DMeasurement = (measurement) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !measurement || !measurement.group) return;

    const corners = referenceObjectsRef.current.slice(4, 8); // Outer circles
    const srcPoints = corners.map(c => ({ x: c.left, y: c.top }));

    // Destination points for homography (normalized 0-1 rectangle)
    const dstPoints = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ];

    try {
      const matrix = computeHomography(srcPoints, dstPoints);

      const start = { x: measurement.startX, y: measurement.startY };
      const end = { x: measurement.endX, y: measurement.endY };

      const realDistance = calculateRealDistance(start, end, matrix, {
        width: referenceWidth,
        height: referenceHeight
      });

      const distanceText = `${realDistance.toFixed(2)}${referenceUnit}`;

      // Update text in group
      const group = measurement.group;
      const objects = group.getObjects();
      const textObj = objects.find(obj => obj.type === 'text');

      if (textObj) {
        textObj.set('text', distanceText);
        canvas.renderAll();
      }
    } catch (error) {
      console.error('Error recalculating 3D measurement:', error);
    }
  };

  // Create draggable handles for measurement editing
  const createMeasurementHandles = (measurementGroup) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !measurementGroup) return;

    // Remove existing handles
    removeMeasurementHandles();

    // Get measurement data
    const is3D = measurementGroup.customType === '3d-measurement';
    let startX, startY, endX, endY;

    if (measurementGroup.measurementStart && measurementGroup.measurementEnd) {
      startX = measurementGroup.measurementStart.x;
      startY = measurementGroup.measurementStart.y;
      endX = measurementGroup.measurementEnd.x;
      endY = measurementGroup.measurementEnd.y;
    } else {
      // Fallback: extract from line object
      const line = measurementGroup.getObjects().find(obj => obj.type === 'line');
      if (!line) return;

      startX = line.x1 + measurementGroup.left + measurementGroup.width / 2;
      startY = line.y1 + measurementGroup.top + measurementGroup.height / 2;
      endX = line.x2 + measurementGroup.left + measurementGroup.width / 2;
      endY = line.y2 + measurementGroup.top + measurementGroup.height / 2;
    }

    // Create start handle - outer circle
    const startHandle = new fabric.Circle({
      left: startX,
      top: startY,
      radius: 8,
      fill: 'rgba(255, 140, 0, 0.2)',  // Orange transparent
      stroke: '#ff8c00',  // Orange
      strokeWidth: 2,
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      hasBorders: false,
      measurementHandle: true,
      handleType: 'start',
      parentMeasurement: measurementGroup
    });

    // Create start handle - inner dot
    const startDot = new fabric.Circle({
      left: startX,
      top: startY,
      radius: 2,
      fill: '#ff8c00',  // Orange solid
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      measurementHandle: true,
      measurementHandleDot: true,
      parentHandle: startHandle
    });

    // Create end handle - outer circle
    const endHandle = new fabric.Circle({
      left: endX,
      top: endY,
      radius: 8,
      fill: 'rgba(255, 140, 0, 0.2)',  // Orange transparent
      stroke: '#ff8c00',  // Orange
      strokeWidth: 2,
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      hasBorders: false,
      measurementHandle: true,
      handleType: 'end',
      parentMeasurement: measurementGroup
    });

    // Create end handle - inner dot
    const endDot = new fabric.Circle({
      left: endX,
      top: endY,
      radius: 2,
      fill: '#ff8c00',  // Orange solid
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      measurementHandle: true,
      measurementHandleDot: true,
      parentHandle: endHandle
    });

    // Update measurement on handle move
    const updateMeasurement = () => {
      const newStartX = startHandle.left;
      const newStartY = startHandle.top;
      const newEndX = endHandle.left;
      const newEndY = endHandle.top;

      // Move dots with handles
      startDot.set({ left: newStartX, top: newStartY });
      endDot.set({ left: newEndX, top: newEndY });

      // Update stored coordinates
      measurementGroup.measurementStart = { x: newStartX, y: newStartY };
      measurementGroup.measurementEnd = { x: newEndX, y: newEndY };

      // Recreate measurement with new coordinates
      if (is3D) {
        recreate3DMeasurement(measurementGroup, { x: newStartX, y: newStartY }, { x: newEndX, y: newEndY });
      } else {
        recreateNormalMeasurement(measurementGroup, { x: newStartX, y: newStartY }, { x: newEndX, y: newEndY });
      }
    };

    startHandle.on('moving', updateMeasurement);
    endHandle.on('moving', updateMeasurement);

    canvas.add(startHandle);
    canvas.add(endHandle);
    canvas.add(startDot);
    canvas.add(endDot);

    measurementHandlesRef.current = [startHandle, endHandle, startDot, endDot];
    canvas.renderAll();
  };

  // Remove measurement handles
  const removeMeasurementHandles = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    measurementHandlesRef.current.forEach(handle => canvas.remove(handle));
    measurementHandlesRef.current = [];
    canvas.renderAll();
  };

  // Recreate 3D measurement with new coordinates
  const recreate3DMeasurement = (group, start, end) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || referenceObjectsRef.current.length === 0) return;

    try {
      const corners = referenceObjectsRef.current.slice(4, 8);
      const srcPoints = corners.map(c => ({ x: c.left, y: c.top }));

      const dstPoints = [
        { x: 0, y: 0 },
        { x: referenceWidth, y: 0 },
        { x: referenceWidth, y: referenceHeight },
        { x: 0, y: referenceHeight }
      ];

      const matrix = computeHomography(srcPoints, dstPoints);
      const realDistance = calculateRealDistance(start, end, matrix, {
        width: referenceWidth,
        height: referenceHeight
      });

      const startInBounds = isPointInCalibration(start, matrix);
      const endInBounds = isPointInCalibration(end, matrix);
      const color = (startInBounds && endInBounds) ? group.getObjects()[0].stroke : '#ff8800';

      const distanceText = `${realDistance.toFixed(2)}${referenceUnit}`;

      // Update line
      const line = group.getObjects()[0];
      line.set({ x1: start.x - group.left - group.width / 2, y1: start.y - group.top - group.height / 2, x2: end.x - group.left - group.width / 2, y2: end.y - group.top - group.height / 2, stroke: color });

      // Update arrows
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const arrow1 = group.getObjects()[1];
      const arrow2 = group.getObjects()[2];
      arrow1.set({ left: start.x - group.left - group.width / 2, top: start.y - group.top - group.height / 2, angle: (angle * 180 / Math.PI) + 90, fill: color });
      arrow2.set({ left: end.x - group.left - group.width / 2, top: end.y - group.top - group.height / 2, angle: (angle * 180 / Math.PI) - 90, fill: color });

      // Update text
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      const text = group.getObjects()[3];
      text.set({ left: midX - group.left - group.width / 2, top: midY - 20 - group.top - group.height / 2, text: distanceText, fill: color });

      group.customName = distanceText;
      group.realDistance = realDistance;

      canvas.renderAll();
      updateLayers();
    } catch (error) {
      console.error('Error recreating 3D measurement:', error);
    }
  };

  // Recreate normal measurement with new coordinates
  const recreateNormalMeasurement = (group, start, end) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const distance = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    const distanceText = `${Math.round(distance)}px`;

    const color = group.getObjects()[0].stroke;

    // Update line
    const line = group.getObjects()[0];
    line.set({ x1: start.x - group.left - group.width / 2, y1: start.y - group.top - group.height / 2, x2: end.x - group.left - group.width / 2, y2: end.y - group.top - group.height / 2 });

    // Update arrows
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const arrow1 = group.getObjects()[1];
    const arrow2 = group.getObjects()[2];
    arrow1.set({ left: start.x - group.left - group.width / 2, top: start.y - group.top - group.height / 2, angle: (angle * 180 / Math.PI) + 90 });
    arrow2.set({ left: end.x - group.left - group.width / 2, top: end.y - group.top - group.height / 2, angle: (angle * 180 / Math.PI) - 90 });

    // Update text
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const text = group.getObjects()[3];
    text.set({ left: midX - group.left - group.width / 2, top: midY - 20 - group.top - group.height / 2, text: distanceText });

    group.customName = distanceText;

    canvas.renderAll();
    updateLayers();
  };

  // Tool handlers
  const handleToolChange = (tool) => {
    setActiveTool(tool);
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Clear active freehand path when switching tools
    if (tool !== 'freehand') {
      setActiveFreehandPath(null);
    }

    canvas.isDrawingMode = tool === 'freehand';
    canvas.selection = tool === 'select';

    // Configure freehand brush with color and width
    if (tool === 'freehand' && canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = strokeColor;
      canvas.freeDrawingBrush.width = strokeWidth;
    }

    if (tool === 'measurement') {
      setMeasurementPoints([]);
    }

    // 3D Measurement tool - auto-create reference rectangle
    if (tool === '3d-measurement') {
      if (!has3DReference) {
        createReferenceRectangle();
      }
    }
  };

  // Remove 3D reference rectangle and all measurements
  const remove3DReference = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Remove reference objects
    referenceObjectsRef.current.forEach(obj => canvas.remove(obj));
    referenceObjectsRef.current = [];

    // Remove all 3D measurements
    threeDMeasurementsRef.current.forEach(m => {
      if (m.group) canvas.remove(m.group);
    });
    threeDMeasurementsRef.current = [];

    setHas3DReference(false);
    canvas.renderAll();
  };

  // Update freehand brush when color or width changes
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || activeTool !== 'freehand' || !canvas.freeDrawingBrush) return;

    canvas.freeDrawingBrush.color = strokeColor;
    canvas.freeDrawingBrush.width = strokeWidth;
  }, [strokeColor, strokeWidth, activeTool]);

  // Handle freehand drawing - keep one active layer
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const handlePathCreated = (e) => {
      const path = e.path;

      if (!path) return;

      // Set custom properties
      path.customType = 'freehand';
      path.customName = 'Freihand';

      // If there's an active freehand path and it's selected, add to that group
      if (activeFreehandPath && activeFreehandPath.type === 'group') {
        // Remove the newly created path from canvas
        canvas.remove(path);

        // Add to existing group
        activeFreehandPath.addWithUpdate(path);
        canvas.renderAll();
      } else if (activeFreehandPath && activeFreehandPath.type === 'path') {
        // Convert single path to group
        const oldPath = activeFreehandPath;
        canvas.remove(oldPath);
        canvas.remove(path);

        const group = new fabric.Group([oldPath, path], {
          customType: 'freehand',
          customName: 'Freihand',
          selectable: true
        });

        canvas.add(group);
        canvas.setActiveObject(group);
        setActiveFreehandPath(group);
        setSelectedLayer(group.id || group);
      } else {
        // New freehand path - set as active
        setActiveFreehandPath(path);
        canvas.setActiveObject(path);
        setSelectedLayer(path.id || path);
      }

      canvas.renderAll();
    };

    if (activeTool === 'freehand') {
      canvas.on('path:created', handlePathCreated);
    }

    return () => {
      canvas.off('path:created', handlePathCreated);
    };
  }, [activeTool, activeFreehandPath]);

  // Zoom with Shift + Mouse Wheel
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const handleMouseWheel = (opt) => {
      const e = opt.e;

      // Only zoom when Shift is pressed
      if (!e.shiftKey) return;

      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY;
      let zoom = canvas.getZoom();

      // Zoom in/out by 10%
      zoom *= 0.999 ** delta;

      // Limit zoom range
      if (zoom > 20) zoom = 20;
      if (zoom < 0.1) zoom = 0.1;

      // Zoom to mouse position
      const point = new fabric.Point(opt.e.offsetX, opt.e.offsetY);
      canvas.zoomToPoint(point, zoom);

      opt.e.preventDefault();
      opt.e.stopPropagation();
    };

    canvas.on('mouse:wheel', handleMouseWheel);

    return () => {
      canvas.off('mouse:wheel', handleMouseWheel);
    };
  }, []);

  // Delete selected object with Delete or Backspace key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;

        const activeObject = canvas.getActiveObject();
        if (activeObject) {
          canvas.remove(activeObject);
          canvas.renderAll();
          setSelectedLayer(null);
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Drag drawing for shapes
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e) => {
      const pointer = canvas.getPointer(e.e);

      // Don't draw if clicking on existing object (except for reference points which are selectable)
      if (e.target && !e.target.referenceObject) return;

      // For 3D measurement tool with reference
      if (activeTool === '3d-measurement' && has3DReference) {
        // If clicking on a reference point, let it be dragged (don't start measurement)
        if (e.target && e.target.objectType === 'referencePoint') {
          return;
        }

        // Otherwise start measurement drag
        dragStartRef.current = pointer;
        dragStartTimeRef.current = Date.now();
        isDrawingRef.current = true;
        return;
      }

      // Only for drawing tools
      if (!['measurement', 'arrow', 'rectangle', 'circle', 'text', 'line'].includes(activeTool)) return;

      dragStartRef.current = pointer;
      dragStartTimeRef.current = Date.now();
      isDrawingRef.current = true;

      // For text tool, create immediately
      if (activeTool === 'text') {
        const text = new fabric.Text('Text bearbeiten...', {
          left: pointer.x,
          top: pointer.y,
          fontSize: fontSize,
          fill: strokeColor,
          customType: 'text',
          customName: 'Text bearbeiten...',
          editable: true
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        isDrawingRef.current = false;
        dragStartRef.current = null;
        dragStartTimeRef.current = null;
      }
    };

    const handleMouseMove = (e) => {
      if (!isDrawingRef.current || !dragStartRef.current) return;

      const pointer = canvas.getPointer(e.e);

      // Remove previous temp object
      if (tempObjectRef.current) {
        canvas.remove(tempObjectRef.current);
        tempObjectRef.current = null;
      }

      let newTempObject = null;

      switch (activeTool) {
        case 'line':
          newTempObject = createTempLine(dragStartRef.current, pointer);
          break;
        case 'measurement':
          newTempObject = createTempMeasurement(dragStartRef.current, pointer);
          break;
        case '3d-measurement':
          if (calibrationData) {
            newTempObject = createTemp3DMeasurement(dragStartRef.current, pointer);
          }
          break;
        case 'arrow':
          newTempObject = createTempArrow(dragStartRef.current, pointer);
          break;
        case 'rectangle':
          newTempObject = createTempRectangle(dragStartRef.current, pointer);
          break;
        case 'circle':
          newTempObject = createTempCircle(dragStartRef.current, pointer);
          break;
      }

      if (newTempObject) {
        newTempObject.selectable = false;
        newTempObject.evented = false;
        canvas.add(newTempObject);
        tempObjectRef.current = newTempObject;
        canvas.renderAll();
      }
    };

    const handleMouseUp = (e) => {
      if (!isDrawingRef.current || !dragStartRef.current) return;

      const pointer = canvas.getPointer(e.e);
      const dragDuration = Date.now() - dragStartTimeRef.current;
      const dragDistance = Math.sqrt(
        Math.pow(pointer.x - dragStartRef.current.x, 2) + Math.pow(pointer.y - dragStartRef.current.y, 2)
      );

      // Remove temp object
      if (tempObjectRef.current) {
        canvas.remove(tempObjectRef.current);
        tempObjectRef.current = null;
      }

      // Only create object if drag duration > 500ms OR drag distance > 10px
      if (dragDuration > 500 || dragDistance > 10) {
        // Create final object
        switch (activeTool) {
          case 'line':
            createFinalLine(dragStartRef.current, pointer);
            break;
          case 'measurement':
            createFinalMeasurement(dragStartRef.current, pointer);
            break;
          case '3d-measurement':
            if (has3DReference) {
              createFinal3DMeasurement(dragStartRef.current, pointer);
            }
            break;
          case 'arrow':
            createFinalArrow(dragStartRef.current, pointer);
            break;
          case 'rectangle':
            createFinalRectangle(dragStartRef.current, pointer);
            break;
          case 'circle':
            createFinalCircle(dragStartRef.current, pointer);
            break;
        }
      }

      isDrawingRef.current = false;
      dragStartRef.current = null;
      dragStartTimeRef.current = null;
      canvas.renderAll();
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
    };
  }, [activeTool, strokeColor, strokeWidth, fontSize, has3DReference]);

  // Temporary object creation for drag preview
  const createTempLine = (start, end) => {
    return new fabric.Line([start.x, start.y, end.x, end.y], {
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      opacity: 0.6
    });
  };

  const createTempMeasurement = (start, end) => {
    const distance = Math.sqrt(
      Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
    ).toFixed(0);

    const line = new fabric.Line([start.x, start.y, end.x, end.y], {
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      opacity: 0.6
    });

    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const arrowSize = 10;

    const arrow1 = new fabric.Triangle({
      left: start.x,
      top: start.y,
      width: arrowSize,
      height: arrowSize,
      fill: strokeColor,
      angle: (angle * 180 / Math.PI) + 90,
      originX: 'center',
      originY: 'center',
      opacity: 0.6
    });

    const arrow2 = new fabric.Triangle({
      left: end.x,
      top: end.y,
      width: arrowSize,
      height: arrowSize,
      fill: strokeColor,
      angle: (angle * 180 / Math.PI) - 90,
      originX: 'center',
      originY: 'center',
      opacity: 0.6
    });

    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    const text = new fabric.Text(`${distance}px`, {
      left: midX,
      top: midY - 20,
      fontSize: fontSize,
      fill: strokeColor,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      padding: 4,
      originX: 'center',
      opacity: 0.6
    });

    return new fabric.Group([line, arrow1, arrow2, text]);
  };

  const createTemp3DMeasurement = (start, end) => {
    if (referenceObjectsRef.current.length === 0) return null;

    try {
      // Get corner positions from reference points
      const corners = referenceObjectsRef.current.slice(4, 8);
      const srcPoints = corners.map(c => ({ x: c.left, y: c.top }));

      // Destination points for homography
      const dstPoints = [
        { x: 0, y: 0 },
        { x: referenceWidth, y: 0 },
        { x: referenceWidth, y: referenceHeight },
        { x: 0, y: referenceHeight }
      ];

      const matrix = computeHomography(srcPoints, dstPoints);

      // Calculate real distance
      const realDistance = calculateRealDistance(start, end, matrix, {
        width: referenceWidth,
        height: referenceHeight
      });

      // Check if points are within reference area
      const startInBounds = isPointInCalibration(start, matrix);
      const endInBounds = isPointInCalibration(end, matrix);
      const color = (startInBounds && endInBounds) ? strokeColor : '#ff8800';

      const line = new fabric.Line([start.x, start.y, end.x, end.y], {
        stroke: color,
        strokeWidth: strokeWidth,
        opacity: 0.6
      });

      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const arrowSize = 10;

      const arrow1 = new fabric.Triangle({
        left: start.x,
        top: start.y,
        width: arrowSize,
        height: arrowSize,
        fill: color,
        angle: (angle * 180 / Math.PI) + 90,
        originX: 'center',
        originY: 'center',
        opacity: 0.6
      });

      const arrow2 = new fabric.Triangle({
        left: end.x,
        top: end.y,
        width: arrowSize,
        height: arrowSize,
        fill: color,
        angle: (angle * 180 / Math.PI) - 90,
        originX: 'center',
        originY: 'center',
        opacity: 0.6
      });

      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;

      const distanceText = `${realDistance.toFixed(2)}${referenceUnit}`;
      const text = new fabric.Text(distanceText, {
        left: midX,
        top: midY - 20,
        fontSize: fontSize,
        fill: color,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        padding: 4,
        originX: 'center',
        opacity: 0.6
      });

      return new fabric.Group([line, arrow1, arrow2, text]);
    } catch (error) {
      console.error('Error creating 3D measurement:', error);
      return null;
    }
  };

  const createTempArrow = (start, end) => {
    const line = new fabric.Line([start.x, start.y, end.x, end.y], {
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      opacity: 0.6
    });

    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const arrowHead = new fabric.Triangle({
      left: end.x,
      top: end.y,
      width: 15,
      height: 15,
      fill: strokeColor,
      angle: (angle * 180 / Math.PI) + 90,
      originX: 'center',
      originY: 'center',
      opacity: 0.6
    });

    return new fabric.Group([line, arrowHead]);
  };

  const createTempRectangle = (start, end) => {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    return new fabric.Rect({
      left: left,
      top: top,
      width: width,
      height: height,
      fill: 'transparent',
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      opacity: 0.6
    });
  };

  const createTempCircle = (start, end) => {
    const radius = Math.sqrt(
      Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
    );

    return new fabric.Circle({
      left: start.x - radius,
      top: start.y - radius,
      radius: radius,
      fill: 'transparent',
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      opacity: 0.6
    });
  };

  // Helper function to add line controls
  const addLineControls = (line) => {
    // Custom control for line start point
    line.controls = {
      p0: new fabric.Control({
        positionHandler: function(dim, finalMatrix, fabricObject) {
          return fabric.util.transformPoint(
            { x: fabricObject.x1 - fabricObject.pathOffset.x, y: fabricObject.y1 - fabricObject.pathOffset.y },
            fabricObject.calcTransformMatrix()
          );
        },
        actionHandler: function(eventData, transform, x, y) {
          const line = transform.target;
          const pointer = line.canvas.getPointer(eventData.e);
          const localPointer = fabric.util.transformPoint(
            pointer,
            fabric.util.invertTransform(line.calcTransformMatrix())
          );
          line.set({ x1: localPointer.x, y1: localPointer.y });
          return true;
        },
        cursorStyle: 'pointer',
        actionName: 'modifyLine',
        render: function(ctx, left, top, styleOverride, fabricObject) {
          ctx.save();
          ctx.fillStyle = strokeColor;
          ctx.beginPath();
          ctx.arc(left, top, 5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.restore();
        }
      }),
      p1: new fabric.Control({
        positionHandler: function(dim, finalMatrix, fabricObject) {
          return fabric.util.transformPoint(
            { x: fabricObject.x2 - fabricObject.pathOffset.x, y: fabricObject.y2 - fabricObject.pathOffset.y },
            fabricObject.calcTransformMatrix()
          );
        },
        actionHandler: function(eventData, transform, x, y) {
          const line = transform.target;
          const pointer = line.canvas.getPointer(eventData.e);
          const localPointer = fabric.util.transformPoint(
            pointer,
            fabric.util.invertTransform(line.calcTransformMatrix())
          );
          line.set({ x2: localPointer.x, y2: localPointer.y });
          return true;
        },
        cursorStyle: 'pointer',
        actionName: 'modifyLine',
        render: function(ctx, left, top, styleOverride, fabricObject) {
          ctx.save();
          ctx.fillStyle = strokeColor;
          ctx.beginPath();
          ctx.arc(left, top, 5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.restore();
        }
      })
    };

    line.hasBorders = false;
    line.hasControls = true;
  };

  // Final object creation
  const createFinalLine = (start, end) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const line = new fabric.Line([start.x, start.y, end.x, end.y], {
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      customType: 'line',
      customName: 'Linie',
      objectCaching: false
    });

    addLineControls(line);
    canvas.add(line);
  };

  const createFinalMeasurement = (start, end) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const distance = Math.sqrt(
      Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
    ).toFixed(0);

    const defaultText = `${distance}px`;
    const line = new fabric.Line([start.x, start.y, end.x, end.y], {
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      selectable: false
    });

    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const arrowSize = 10;

    const arrow1 = new fabric.Triangle({
      left: start.x,
      top: start.y,
      width: arrowSize,
      height: arrowSize,
      fill: strokeColor,
      angle: (angle * 180 / Math.PI) + 90,
      originX: 'center',
      originY: 'center',
      selectable: false
    });

    const arrow2 = new fabric.Triangle({
      left: end.x,
      top: end.y,
      width: arrowSize,
      height: arrowSize,
      fill: strokeColor,
      angle: (angle * 180 / Math.PI) - 90,
      originX: 'center',
      originY: 'center',
      selectable: false
    });

    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    const textObj = new fabric.Text(defaultText, {
      left: midX,
      top: midY - 20,
      fontSize: fontSize,
      fill: strokeColor,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      padding: 4,
      originX: 'center',
      selectable: false
    });

    const group = new fabric.Group([line, arrow1, arrow2, textObj], {
      customType: 'measurement',
      customName: defaultText,
      editable: true,
      selectable: true,
      hasControls: false,
      hasBorders: false,
      subTargetCheck: true,
      objectCaching: false
    });

    // Store original coordinates for editing
    group.measurementStart = { x: start.x, y: start.y };
    group.measurementEnd = { x: end.x, y: end.y };

    canvas.add(group);
  };

  const createFinal3DMeasurement = (start, end) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || referenceObjectsRef.current.length === 0) return;

    try {
      // Get corner positions from reference points
      const corners = referenceObjectsRef.current.slice(4, 8);
      const srcPoints = corners.map(c => ({ x: c.left, y: c.top }));

      // Destination points for homography (normalized 0-1 rectangle)
      // calculateRealDistance will scale by realDimensions
      const dstPoints = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
      ];

      // Compute homography matrix
      const matrix = computeHomography(srcPoints, dstPoints);

      // Calculate real distance
      const realDistance = calculateRealDistance(start, end, matrix, {
        width: referenceWidth,
        height: referenceHeight
      });

      // Check if points are within reference area
      const startInBounds = isPointInCalibration(start, matrix);
      const endInBounds = isPointInCalibration(end, matrix);
      const color = (startInBounds && endInBounds) ? strokeColor : '#ff8800'; // Orange if out of bounds

      const distanceText = `${realDistance.toFixed(2)}${referenceUnit}`;

      const line = new fabric.Line([start.x, start.y, end.x, end.y], {
        stroke: color,
        strokeWidth: strokeWidth,
        selectable: false
      });

      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;

      const textObj = new fabric.Text(distanceText, {
        left: midX,
        top: midY - 20,
        fontSize: fontSize,
        fill: color,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        padding: 4,
        originX: 'center',
        selectable: false
      });

      const group = new fabric.Group([line, textObj], {
        customType: '3d-measurement',
        customName: distanceText,
        editable: false,
        selectable: false,  // Not movable - only via handles
        hasControls: false,
        hasBorders: false,
        evented: false,  // No events on group
        objectCaching: false
      });

      // Store measurement coordinates
      group.measurementStart = { x: start.x, y: start.y };
      group.measurementEnd = { x: end.x, y: end.y };

      // Store measurement data for live updates
      const measurementData = {
        group: group,
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        realDistance: realDistance,
        unit: referenceUnit
      };

      threeDMeasurementsRef.current.push(measurementData);

      canvas.add(group);
    } catch (error) {
      console.error('Error creating final 3D measurement:', error);
      alert(`Fehler beim Erstellen der 3D-Messung: ${error.message}`);
    }
  };

  const createFinalArrow = (start, end) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const line = new fabric.Line([start.x, start.y, end.x, end.y], {
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      selectable: false,
      objectCaching: false
    });

    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const arrowHead = new fabric.Triangle({
      left: end.x,
      top: end.y,
      width: 15,
      height: 15,
      fill: strokeColor,
      angle: (angle * 180 / Math.PI) + 90,
      originX: 'center',
      originY: 'center',
      selectable: false,
      objectCaching: false
    });

    const group = new fabric.Group([line, arrowHead], {
      customType: 'arrow',
      customName: 'Pfeil',
      selectable: true,
      subTargetCheck: true,
      objectCaching: false
    });

    // Store original coordinates for editing
    group.arrowStart = { x: start.x, y: start.y };
    group.arrowEnd = { x: end.x, y: end.y };

    canvas.add(group);
  };

  const createFinalRectangle = (start, end) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    const rect = new fabric.Rect({
      left: left,
      top: top,
      width: width,
      height: height,
      fill: 'transparent',
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      customType: 'rectangle',
      customName: 'Rechteck',
      objectCaching: false
    });

    canvas.add(rect);
  };

  const createFinalCircle = (start, end) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const radius = Math.sqrt(
      Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
    );

    const circle = new fabric.Circle({
      left: start.x - radius,
      top: start.y - radius,
      radius: radius,
      fill: 'transparent',
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      customType: 'circle',
      customName: 'Kreis',
      objectCaching: false
    });

    canvas.add(circle);
  };

  // Layer operations
  const deleteLayer = (layerId) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const obj = layers.find(l => l.id === layerId)?.object;
    if (obj) {
      canvas.remove(obj);
      canvas.renderAll();
    }
  };

  const toggleLayerVisibility = (layerId) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const obj = layers.find(l => l.id === layerId)?.object;
    if (obj) {
      obj.visible = !obj.visible;
      canvas.renderAll();
      updateLayers();
    }
  };

  const selectLayer = (layerId) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    canvas.discardActiveObject();
    const obj = layers.find(l => l.id === layerId)?.object;
    if (obj) {
      canvas.setActiveObject(obj);
      canvas.renderAll();
      setSelectedLayer(layerId);

      // If it's a freehand path and freehand tool is active, set as active path
      if (activeTool === 'freehand' && obj.customType === 'freehand') {
        setActiveFreehandPath(obj);
      }
    }
  };

  const startEditingLayer = (layerId, currentName) => {
    setEditingLayerId(layerId);
    setEditingText(currentName);
  };

  const finishEditingLayer = (layerId) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const obj = layers.find(l => l.id === layerId)?.object;
    if (obj && editingText.trim()) {
      // Update customName
      obj.customName = editingText.trim();

      // If it's a text object, update the actual text
      if (obj.type === 'text') {
        obj.set('text', editingText.trim());
      }

      // If it's a group with text (like measurement), update the text element
      if (obj.type === 'group' && obj.editable) {
        const items = obj._objects || obj.getObjects();
        const textItem = items.find(item => item.type === 'text');
        if (textItem) {
          textItem.set('text', editingText.trim());
          obj.customName = editingText.trim();
        }
      }

      canvas.renderAll();
      updateLayers();
    }

    setEditingLayerId(null);
    setEditingText('');
  };

  const moveLayerUp = (layerId) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const obj = layers.find(l => l.id === layerId)?.object;
    if (obj) {
      canvas.bringForward(obj);
      canvas.renderAll();
      updateLayers();
    }
  };

  const moveLayerDown = (layerId) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const obj = layers.find(l => l.id === layerId)?.object;
    if (obj) {
      canvas.sendBackwards(obj);
      canvas.renderAll();
      updateLayers();
    }
  };

  // Save handlers
  const handleSaveOverwrite = async () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Check if image has ID (required for saving)
    if (!image.id) {
      alert('❌ Dieses Bild ist nicht in der Datenbank registriert!\n\nUm es zu bearbeiten, musst du es zuerst über die "Bilder"-Seite in die Datenbank importieren.');
      return;
    }

    if (!confirm('Original-Bild überschreiben?')) return;

    try {
      // Hide reference objects before export
      const wasVisible = [];
      referenceObjectsRef.current.forEach((obj, idx) => {
        wasVisible[idx] = obj.visible !== false;
        obj.set('visible', false);
      });
      canvas.renderAll();

      const dataURL = canvas.toDataURL({
        format: 'png',
        quality: 1
      });

      // Restore visibility
      referenceObjectsRef.current.forEach((obj, idx) => {
        obj.set('visible', wasVisible[idx]);
      });
      canvas.renderAll();

      const canvasData = canvas.toJSON(['customType', 'customName']);

      // Add 3D reference data to annotations
      const annotationsData = {
        ...canvasData,
        referenceData: has3DReference ? {
          width: referenceWidth,
          height: referenceHeight,
          unit: referenceUnit
        } : null
      };

      const annotations = JSON.stringify(annotationsData);

      const response = await fetch(`/api/annotations/${image.id}/export/overwrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataURL, annotations })
      });

      if (response.ok) {
        alert('Bild erfolgreich überschrieben!');
        onClose();
        // Reload page to show updated image
        window.location.reload();
      } else {
        alert('Fehler beim Speichern des Bildes');
      }
    } catch (error) {
      console.error('Error saving image:', error);
      alert('Fehler beim Speichern des Bildes');
    }
  };

  const handleSaveNew = async () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    // Check if image has ID (required for saving)
    if (!image.id) {
      alert('❌ Dieses Bild ist nicht in der Datenbank registriert!\n\nUm es zu bearbeiten, musst du es zuerst über die "Bilder"-Seite in die Datenbank importieren.');
      return;
    }

    try {
      // Hide reference objects before export
      const wasVisible = [];
      referenceObjectsRef.current.forEach((obj, idx) => {
        wasVisible[idx] = obj.visible !== false;
        obj.set('visible', false);
      });
      canvas.renderAll();

      const dataURL = canvas.toDataURL({
        format: 'png',
        quality: 1
      });

      // Restore visibility
      referenceObjectsRef.current.forEach((obj, idx) => {
        obj.set('visible', wasVisible[idx]);
      });
      canvas.renderAll();

      const canvasData = canvas.toJSON(['customType', 'customName']);

      // Add 3D reference data to annotations
      const annotationsData = {
        ...canvasData,
        referenceData: has3DReference ? {
          width: referenceWidth,
          height: referenceHeight,
          unit: referenceUnit
        } : null
      };

      const annotations = JSON.stringify(annotationsData);

      const response = await fetch(`/api/annotations/${image.id}/export/new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataURL, annotations })
      });

      if (response.ok) {
        const data = await response.json();
        alert('Neues Bild erfolgreich erstellt!');
        onClose();
        // Reload page to show new image
        window.location.reload();
      } else {
        alert('Fehler beim Erstellen des neuen Bildes');
      }
    } catch (error) {
      console.error('Error creating new image:', error);
      alert('Fehler beim Erstellen des neuen Bildes');
    }
  };

  // Zoom functions
  const handleZoomIn = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    let zoom = canvas.getZoom();
    zoom = zoom * 1.1;
    if (zoom > 20) zoom = 20;

    canvas.setZoom(zoom);
    canvas.renderAll();
  };

  const handleZoomOut = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    let zoom = canvas.getZoom();
    zoom = zoom / 1.1;
    if (zoom < 0.1) zoom = 0.1;

    canvas.setZoom(zoom);
    canvas.renderAll();
  };

  const handleZoomReset = () => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    canvas.setZoom(1);
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.renderAll();
  };

  return (
    <div className="image-editor-overlay">
      <div className="image-editor-modal">
        {/* Header */}
        <div className="editor-header">
          <h2>Bild-Editor: {image.name}</h2>
          <button className="close-btn" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        {/* Main content */}
        <div className="editor-body">
          {/* Toolbar */}
          <div className="editor-toolbar">
            <h3>Werkzeuge</h3>

            <button
              className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`}
              onClick={() => handleToolChange('select')}
              title="Auswählen"
            >
              <MousePointer size={20} />
              <span>Auswählen</span>
            </button>

            <button
              className={`tool-btn ${activeTool === 'measurement' ? 'active' : ''}`}
              onClick={() => handleToolChange('measurement')}
              title="Bemaßung"
            >
              <Ruler size={20} />
              <span>Bemaßung</span>
            </button>

            <button
              className={`tool-btn ${activeTool === '3d-measurement' ? 'active' : ''}`}
              onClick={() => handleToolChange('3d-measurement')}
              title="3D Bemaßung (Perspektive)"
            >
              <Box size={20} />
              <span>3D Bemaßung</span>
            </button>

            <button
              className={`tool-btn ${activeTool === 'line' ? 'active' : ''}`}
              onClick={() => handleToolChange('line')}
              title="Linie"
            >
              <Minus size={20} />
              <span>Linie</span>
            </button>

            <button
              className={`tool-btn ${activeTool === 'arrow' ? 'active' : ''}`}
              onClick={() => handleToolChange('arrow')}
              title="Pfeil"
            >
              <ArrowRight size={20} />
              <span>Pfeil</span>
            </button>

            <button
              className={`tool-btn ${activeTool === 'rectangle' ? 'active' : ''}`}
              onClick={() => handleToolChange('rectangle')}
              title="Rechteck"
            >
              <Square size={20} />
              <span>Rechteck</span>
            </button>

            <button
              className={`tool-btn ${activeTool === 'circle' ? 'active' : ''}`}
              onClick={() => handleToolChange('circle')}
              title="Kreis"
            >
              <Circle size={20} />
              <span>Kreis</span>
            </button>

            <button
              className={`tool-btn ${activeTool === 'text' ? 'active' : ''}`}
              onClick={() => handleToolChange('text')}
              title="Text"
            >
              <Type size={20} />
              <span>Text</span>
            </button>

            <button
              className={`tool-btn ${activeTool === 'freehand' ? 'active' : ''}`}
              onClick={() => handleToolChange('freehand')}
              title="Freihand"
            >
              <Pencil size={20} />
              <span>Freihand</span>
            </button>

            <div style={{ borderTop: '1px solid #444', margin: '10px 0', paddingTop: '10px' }}>
              <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Zoom</h4>
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                <button
                  className="tool-btn"
                  onClick={handleZoomIn}
                  title="Vergrößern (Shift + Scroll)"
                  style={{ flex: '1' }}
                >
                  <ZoomIn size={20} />
                </button>
                <button
                  className="tool-btn"
                  onClick={handleZoomOut}
                  title="Verkleinern (Shift + Scroll)"
                  style={{ flex: '1' }}
                >
                  <ZoomOut size={20} />
                </button>
                <button
                  className="tool-btn"
                  onClick={handleZoomReset}
                  title="Zurücksetzen"
                  style={{ flex: '1' }}
                >
                  <RotateCcw size={20} />
                </button>
              </div>
            </div>

            <div className="tool-settings">
              <label>
                Farbe:
                <input
                  type="color"
                  value={strokeColor}
                  onChange={(e) => setStrokeColor(e.target.value)}
                />
              </label>

              {/* Color Quick-Select Presets */}
              <div className="color-presets">
                <label style={{ marginBottom: '5px', display: 'block', fontSize: '12px' }}>
                  Schnellauswahl:
                </label>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  {Array.from({ length: NUM_COLOR_SLOTS }).map((_, index) => {
                    const preset = colorPresets.find(p => p.position === index);
                    return (
                      <button
                        key={index}
                        className="color-preset-btn"
                        style={{
                          backgroundColor: preset ? preset.color : '#333',
                          border: preset && preset.color === strokeColor ? '2px solid white' : '1px solid #555',
                          width: '32px',
                          height: '32px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          position: 'relative'
                        }}
                        onClick={() => {
                          if (preset) {
                            setStrokeColor(preset.color);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          // Right-click: Save current color to this slot
                          saveColorPreset(strokeColor, index);
                        }}
                        title={preset ? `${preset.color} (Rechtsklick zum Überschreiben)` : 'Rechtsklick zum Speichern'}
                      >
                        {!preset && (
                          <span style={{ fontSize: '16px', color: '#666' }}>+</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label>
                Strichstärke:
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={strokeWidth}
                  onChange={(e) => setStrokeWidth(Number(e.target.value))}
                />
                <span>{strokeWidth}px</span>
              </label>

              <label>
                Schriftgröße:
                <input
                  type="range"
                  min="12"
                  max="48"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                />
                <span>{fontSize}px</span>
              </label>
            </div>
          </div>

          {/* Canvas */}
          <div className="editor-canvas-container" ref={containerRef}>
            <canvas ref={canvasRef} />
          </div>

          {/* Layers panel */}
          <div className="editor-layers">
            <h3>Ebenen ({layers.length})</h3>
            <div className="layers-list">
              {layers.length === 0 && (
                <div className="layers-empty">Keine Ebenen vorhanden</div>
              )}
              {layers.map((layer) => (
                <div
                  key={layer.id}
                  className={`layer-item ${selectedLayer === layer.id ? 'selected' : ''} ${layer.object && !layer.object.visible ? 'hidden' : ''}`}
                >
                  {/* Special rendering for 3D reference layer */}
                  {layer.isReferenceLayer ? (
                    <div style={{ padding: '10px', background: 'rgba(0, 255, 255, 0.1)', borderRadius: '4px' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: referenceCollapsed ? '0' : '10px',
                        cursor: 'pointer'
                      }}
                      onClick={() => setReferenceCollapsed(!referenceCollapsed)}
                      >
                        <div style={{ fontWeight: 'bold', color: '#00ffff' }}>
                          {layer.name}
                        </div>
                        <button
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#00ffff',
                            cursor: 'pointer',
                            padding: '2px'
                          }}
                          title={referenceCollapsed ? "Ausklappen" : "Einklappen"}
                        >
                          {referenceCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                        </button>
                      </div>

                      {!referenceCollapsed && (
                        <>
                          <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ color: '#ccc' }}>
                              Horizontal (cm):
                              <input
                                type="number"
                                step="1"
                                min="1"
                                value={referenceWidth}
                                onChange={(e) => {
                                  setReferenceWidth(parseFloat(e.target.value) || 100);
                                  updateAll3DMeasurements();
                                }}
                                style={{
                                  width: '100%',
                                  marginTop: '3px',
                                  padding: '6px',
                                  background: '#2a2a2a',
                                  border: '1px solid #444',
                                  borderRadius: '4px',
                                  color: '#fff',
                                  fontSize: '13px'
                                }}
                              />
                            </label>
                            <label style={{ color: '#ccc' }}>
                              Vertikal (cm):
                              <input
                                type="number"
                                step="1"
                                min="1"
                                value={referenceHeight}
                                onChange={(e) => {
                                  setReferenceHeight(parseFloat(e.target.value) || 50);
                                  updateAll3DMeasurements();
                                }}
                                style={{
                                  width: '100%',
                                  marginTop: '3px',
                                  padding: '6px',
                                  background: '#2a2a2a',
                                  border: '1px solid #444',
                                  borderRadius: '4px',
                                  color: '#fff',
                                  fontSize: '13px'
                                }}
                              />
                            </label>
                            <label style={{ color: '#ccc' }}>
                              Einheit:
                              <select
                                value={referenceUnit}
                                onChange={(e) => {
                                  setReferenceUnit(e.target.value);
                                  updateAll3DMeasurements();
                                }}
                                style={{
                                  width: '100%',
                                  marginTop: '3px',
                                  padding: '6px',
                                  background: '#2a2a2a',
                                  border: '1px solid #444',
                                  borderRadius: '4px',
                                  color: '#fff',
                                  fontSize: '13px'
                                }}
                              >
                                <option value="mm">mm</option>
                                <option value="cm">cm</option>
                                <option value="m">m</option>
                              </select>
                            </label>
                          </div>
                          <div className="layer-actions" style={{ marginTop: '10px' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                remove3DReference();
                              }}
                              title="3D Referenz löschen"
                              style={{ width: '100%' }}
                            >
                              <Trash2 size={16} /> Löschen
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      {editingLayerId === layer.id ? (
                        <input
                          type="text"
                          className="layer-name-input"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onBlur={() => finishEditingLayer(layer.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') finishEditingLayer(layer.id);
                            if (e.key === 'Escape') {
                              setEditingLayerId(null);
                              setEditingText('');
                            }
                          }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="layer-name"
                          onClick={() => selectLayer(layer.id)}
                          onDoubleClick={() => startEditingLayer(layer.id, layer.name)}
                        >
                          {layer.name}
                        </span>
                      )}
                      <div className="layer-actions">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLayerVisibility(layer.id);
                          }}
                          title={layer.object.visible ? "Ausblenden" : "Einblenden"}
                        >
                          {layer.object.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditingLayer(layer.id, layer.name);
                          }}
                          title="Text bearbeiten"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            moveLayerUp(layer.id);
                          }}
                          title="Nach oben"
                        >
                          <ChevronUp size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            moveLayerDown(layer.id);
                          }}
                          title="Nach unten"
                        >
                          <ChevronDown size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteLayer(layer.id);
                          }}
                          title="Löschen"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>


        {/* Footer */}
        <div className="editor-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            <XCircle size={18} />
            Abbrechen
          </button>
          <button
            className="btn btn-warning"
            onClick={handleSaveOverwrite}
            disabled={!image.id}
            title={!image.id ? 'Nur registrierte Bilder können überschrieben werden' : 'Original-Bild überschreiben'}
          >
            <Save size={18} />
            Original überschreiben
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSaveNew}
            disabled={!image.id}
            title={!image.id ? 'Nur registrierte Bilder können gespeichert werden' : 'Als neues Bild speichern'}
          >
            <FileDown size={18} />
            Als neues Bild speichern
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImageEditor;
