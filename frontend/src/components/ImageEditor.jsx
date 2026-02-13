import { useEffect, useRef, useState } from 'react';
import { fabric } from 'fabric';
import {
  X, Save, FileDown, XCircle, Minus, Square, Circle, Type,
  Ruler, MousePointer, Trash2, Edit2, ChevronUp, ChevronDown,
  ArrowRight, Pencil, Eye, EyeOff
} from 'lucide-react';
import './ImageEditor.css';

function ImageEditor({ image, onClose }) {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const [activeTool, setActiveTool] = useState('select');
  const [layers, setLayers] = useState([]);
  const [selectedLayer, setSelectedLayer] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState([]);
  const [editingLayerId, setEditingLayerId] = useState(null);
  const [editingText, setEditingText] = useState('');

  // Drag drawing state
  const [dragStart, setDragStart] = useState(null);
  const [dragStartTime, setDragStartTime] = useState(null);
  const [tempObject, setTempObject] = useState(null);
  const [activeFreehandPath, setActiveFreehandPath] = useState(null);

  // Tool colors and settings
  const [strokeColor, setStrokeColor] = useState('#ff0000');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fontSize, setFontSize] = useState(16);

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
    });

    return () => {
      canvas.dispose();
    };
  }, [image]);

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
            canvas.loadFromJSON(data.annotations, () => {
              canvas.renderAll();
              updateLayers();
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

    const objects = canvas.getObjects().map((obj, index) => ({
      id: obj.id || `layer-${index}`,
      type: obj.customType || obj.type,
      name: obj.customName || `${obj.type} ${index + 1}`,
      object: obj
    }));

    setLayers(objects);
  };

  // Handle selection
  const handleSelection = (e) => {
    const obj = e.selected ? e.selected[0] : e.target;
    if (obj) {
      // Find the layer ID by matching the object
      const layer = layers.find(l => l.object === obj);
      if (layer) {
        setSelectedLayer(layer.id);
      }
    }
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
      // Don't draw if clicking on existing object
      if (e.target) return;

      // Only for drawing tools
      if (!['measurement', 'arrow', 'rectangle', 'circle', 'text', 'line'].includes(activeTool)) return;

      const pointer = canvas.getPointer(e.e);
      setDragStart(pointer);
      setDragStartTime(Date.now());
      setIsDrawing(true);

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
        setIsDrawing(false);
        setDragStart(null);
        setDragStartTime(null);
      }
    };

    const handleMouseMove = (e) => {
      if (!isDrawing || !dragStart) return;

      const pointer = canvas.getPointer(e.e);

      // Remove previous temp object
      if (tempObject) {
        canvas.remove(tempObject);
      }

      let newTempObject = null;

      switch (activeTool) {
        case 'line':
          newTempObject = createTempLine(dragStart, pointer);
          break;
        case 'measurement':
          newTempObject = createTempMeasurement(dragStart, pointer);
          break;
        case 'arrow':
          newTempObject = createTempArrow(dragStart, pointer);
          break;
        case 'rectangle':
          newTempObject = createTempRectangle(dragStart, pointer);
          break;
        case 'circle':
          newTempObject = createTempCircle(dragStart, pointer);
          break;
      }

      if (newTempObject) {
        newTempObject.selectable = false;
        newTempObject.evented = false;
        canvas.add(newTempObject);
        setTempObject(newTempObject);
        canvas.renderAll();
      }
    };

    const handleMouseUp = (e) => {
      if (!isDrawing || !dragStart) return;

      const pointer = canvas.getPointer(e.e);
      const dragDuration = Date.now() - dragStartTime;
      const dragDistance = Math.sqrt(
        Math.pow(pointer.x - dragStart.x, 2) + Math.pow(pointer.y - dragStart.y, 2)
      );

      // Remove temp object
      if (tempObject) {
        canvas.remove(tempObject);
        setTempObject(null);
      }

      // Only create object if drag duration > 500ms OR drag distance > 10px
      if (dragDuration > 500 || dragDistance > 10) {
        // Create final object
        switch (activeTool) {
          case 'line':
            createFinalLine(dragStart, pointer);
            break;
          case 'measurement':
            createFinalMeasurement(dragStart, pointer);
            break;
          case 'arrow':
            createFinalArrow(dragStart, pointer);
            break;
          case 'rectangle':
            createFinalRectangle(dragStart, pointer);
            break;
          case 'circle':
            createFinalCircle(dragStart, pointer);
            break;
        }
      }

      setIsDrawing(false);
      setDragStart(null);
      setDragStartTime(null);
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
  }, [activeTool, isDrawing, dragStart, tempObject, strokeColor, strokeWidth, fontSize]);

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
      subTargetCheck: true,
      objectCaching: false
    });

    // Store original coordinates for editing
    group.measurementStart = { x: start.x, y: start.y };
    group.measurementEnd = { x: end.x, y: end.y };

    canvas.add(group);
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
    if (!canvas || !confirm('Original-Bild überschreiben?')) return;

    try {
      const dataURL = canvas.toDataURL({
        format: 'png',
        quality: 1
      });

      const annotations = JSON.stringify(canvas.toJSON(['customType', 'customName']));

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

    try {
      const dataURL = canvas.toDataURL({
        format: 'png',
        quality: 1
      });

      const annotations = JSON.stringify(canvas.toJSON(['customType', 'customName']));

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

            <div className="tool-settings">
              <label>
                Farbe:
                <input
                  type="color"
                  value={strokeColor}
                  onChange={(e) => setStrokeColor(e.target.value)}
                />
              </label>

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
            {isDrawing && (
              <div className="measurement-hint">
                Ziehen Sie, um das Objekt zu erstellen
              </div>
            )}
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
                  className={`layer-item ${selectedLayer === layer.id ? 'selected' : ''} ${!layer.object.visible ? 'hidden' : ''}`}
                >
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
          <button className="btn btn-warning" onClick={handleSaveOverwrite}>
            <Save size={18} />
            Original überschreiben
          </button>
          <button className="btn btn-primary" onClick={handleSaveNew}>
            <FileDown size={18} />
            Als neues Bild speichern
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImageEditor;
