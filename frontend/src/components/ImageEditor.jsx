import { useEffect, useRef, useState } from 'react';
import { fabric } from 'fabric';
import {
  X, Save, FileDown, XCircle, Minus, Square, Circle, Type,
  Ruler, MousePointer, Trash2, Edit2, ChevronUp, ChevronDown,
  ArrowRight, Pencil
} from 'lucide-react';
import './ImageEditor.css';

function ImageEditor({ image, onClose }) {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const [activeTool, setActiveTool] = useState('select');
  const [layers, setLayers] = useState([]);
  const [selectedLayer, setSelectedLayer] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState([]);

  // Tool colors and settings
  const [strokeColor, setStrokeColor] = useState('#ff0000');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fontSize, setFontSize] = useState(16);

  // Initialize Fabric.js canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: 1200,
      height: 800,
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
    canvas.on('selection:cleared', () => setSelectedLayer(null));

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
    const obj = e.selected[0];
    if (obj) {
      setSelectedLayer(obj.id || obj);
    }
  };

  // Tool handlers
  const handleToolChange = (tool) => {
    setActiveTool(tool);
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

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

  // Canvas click handler for measurements
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const handleCanvasClick = (e) => {
      // Don't place new elements if an existing object was clicked
      if (e.target) {
        return;
      }

      if (activeTool === 'measurement') {
        const pointer = canvas.getPointer(e.e);

        if (measurementPoints.length === 0) {
          // First point
          setMeasurementPoints([pointer]);
        } else if (measurementPoints.length === 1) {
          // Second point - create measurement line
          const [point1] = measurementPoints;
          const distance = Math.sqrt(
            Math.pow(pointer.x - point1.x, 2) + Math.pow(pointer.y - point1.y, 2)
          ).toFixed(0);

          const text = prompt('Bemaßung eingeben:', `${distance}px`);
          if (text) {
            createMeasurement(point1, pointer, text);
          }
          setMeasurementPoints([]);
        }
      } else if (activeTool !== 'select' && activeTool !== 'freehand' && activeTool !== 'measurement') {
        const pointer = canvas.getPointer(e.e);

        // Check if click is within canvas bounds
        if (pointer.x >= 0 && pointer.x <= canvas.width &&
            pointer.y >= 0 && pointer.y <= canvas.height) {
          handleDrawing(pointer);
        }
      }
    };

    canvas.on('mouse:down', handleCanvasClick);

    return () => {
      canvas.off('mouse:down', handleCanvasClick);
    };
  }, [activeTool, measurementPoints]);

  // Create measurement
  const createMeasurement = (point1, point2, text) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const group = new fabric.Group([], {
      customType: 'measurement',
      customName: `Bemaßung: ${text}`,
      selectable: true
    });

    // Main line
    const line = new fabric.Line([point1.x, point1.y, point2.x, point2.y], {
      stroke: strokeColor,
      strokeWidth: strokeWidth,
      selectable: false
    });

    // Arrows
    const arrowSize = 10;
    const angle = Math.atan2(point2.y - point1.y, point2.x - point1.x);

    const arrow1 = new fabric.Triangle({
      left: point1.x,
      top: point1.y,
      width: arrowSize,
      height: arrowSize,
      fill: strokeColor,
      angle: (angle * 180 / Math.PI) + 90,
      originX: 'center',
      originY: 'center',
      selectable: false
    });

    const arrow2 = new fabric.Triangle({
      left: point2.x,
      top: point2.y,
      width: arrowSize,
      height: arrowSize,
      fill: strokeColor,
      angle: (angle * 180 / Math.PI) - 90,
      originX: 'center',
      originY: 'center',
      selectable: false
    });

    // Text
    const midX = (point1.x + point2.x) / 2;
    const midY = (point1.y + point2.y) / 2;

    const textObj = new fabric.Text(text, {
      left: midX,
      top: midY - 20,
      fontSize: fontSize,
      fill: strokeColor,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      padding: 4,
      originX: 'center',
      selectable: false
    });

    group.addWithUpdate(line);
    group.addWithUpdate(arrow1);
    group.addWithUpdate(arrow2);
    group.addWithUpdate(textObj);

    canvas.add(group);
    canvas.renderAll();
  };

  // Handle drawing for other tools
  const handleDrawing = (pointer) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    switch (activeTool) {
      case 'line':
        const line = new fabric.Line([pointer.x, pointer.y, pointer.x + 100, pointer.y], {
          stroke: strokeColor,
          strokeWidth: strokeWidth,
          customType: 'line',
          customName: 'Linie'
        });
        canvas.add(line);
        break;

      case 'rectangle':
        const rect = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 100,
          height: 60,
          fill: 'transparent',
          stroke: strokeColor,
          strokeWidth: strokeWidth,
          customType: 'rectangle',
          customName: 'Rechteck'
        });
        canvas.add(rect);
        break;

      case 'circle':
        const circle = new fabric.Circle({
          left: pointer.x,
          top: pointer.y,
          radius: 50,
          fill: 'transparent',
          stroke: strokeColor,
          strokeWidth: strokeWidth,
          customType: 'circle',
          customName: 'Kreis'
        });
        canvas.add(circle);
        break;

      case 'arrow':
        const arrowLine = new fabric.Line([pointer.x, pointer.y, pointer.x + 100, pointer.y], {
          stroke: strokeColor,
          strokeWidth: strokeWidth,
          customType: 'arrow',
          customName: 'Pfeil'
        });

        const arrowHead = new fabric.Triangle({
          left: pointer.x + 100,
          top: pointer.y,
          width: 15,
          height: 15,
          fill: strokeColor,
          angle: 90,
          originX: 'center',
          originY: 'center'
        });

        const arrowGroup = new fabric.Group([arrowLine, arrowHead], {
          customType: 'arrow',
          customName: 'Pfeil'
        });

        canvas.add(arrowGroup);
        break;

      case 'text':
        const textInput = prompt('Text eingeben:');
        if (textInput) {
          const text = new fabric.Text(textInput, {
            left: pointer.x,
            top: pointer.y,
            fontSize: fontSize,
            fill: strokeColor,
            customType: 'text',
            customName: `Text: ${textInput.substring(0, 20)}`
          });
          canvas.add(text);
        }
        break;
    }

    canvas.renderAll();
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

  const selectLayer = (layerId) => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    canvas.discardActiveObject();
    const obj = layers.find(l => l.id === layerId)?.object;
    if (obj) {
      canvas.setActiveObject(obj);
      canvas.renderAll();
      setSelectedLayer(layerId);
    }
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
          <div className="editor-canvas-container">
            <canvas ref={canvasRef} />
            {activeTool === 'measurement' && measurementPoints.length === 1 && (
              <div className="measurement-hint">
                Klicken Sie auf den zweiten Punkt
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
                  className={`layer-item ${selectedLayer === layer.id ? 'selected' : ''}`}
                  onClick={() => selectLayer(layer.id)}
                >
                  <span className="layer-name">{layer.name}</span>
                  <div className="layer-actions">
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
