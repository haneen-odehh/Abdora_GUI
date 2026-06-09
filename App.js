import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Grid, Typography, ThemeProvider, createTheme, CssBaseline,
  Card, CardContent, Tabs, Tab, Button, Slider, Divider, List, ListItem, ListItemText,
  IconButton, Avatar, Badge, Chip, Tooltip
} from '@mui/material';

import {
  Visibility as VisibilityIcon,
  AutoGraph as AutoGraphIcon,
  Assignment as AssignmentIcon,
  AccountCircle as AccountCircleIcon,
  AccountTree as AccountTreeIcon,
  Psychology as PsychologyIcon,
  NotificationsNone as NotificationsNoneIcon,
  SettingsOutlined as SettingsOutlinedIcon,
  HelpOutlined as HelpOutlineIcon,
  CloudUpload as CloudUploadIcon,
  DragIndicator as DragIndicatorIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  RotateRight as RotateRightIcon,
  CropFree as CropIcon,
  Undo as UndoIcon,
  Refresh as RefreshIcon,
  PanTool as SelectIcon,
  Close as CloseIcon,
  OpenInFull as ExpandIcon,
  Fullscreen as FullscreenIcon
} from '@mui/icons-material';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#070913', paper: '#0b0f19' },
    primary: { main: '#4f46e5' },
    secondary: { main: '#10b981' },
    error: { main: '#ef4444' },
    warning: { main: '#f59e0b' },
  },
  typography: { fontFamily: 'Inter, Roboto, sans-serif' },
});

const scrollbarStyles = `
  ::-webkit-scrollbar { width: 8px !important; height: 8px !important; }
  ::-webkit-scrollbar-track { background: transparent !important; }
  ::-webkit-scrollbar-thumb { background: #334155 !important; border-radius: 4px !important; }
  ::-webkit-scrollbar-thumb:hover { background: #475569 !important; }
  * { scrollbar-color: #334155 transparent !important; scrollbar-width: thin !important; }
`;

function App() {
  const [patient, setPatient] = useState({});
  const [worklist, setWorklist] = useState([]);
  const [rightTab, setRightTab] = useState(0);
  const [activeNav, setActiveNav] = useState('Viewer');
  const [centerWidth, setCenterWidth] = useState(75);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);
  const fileInputRef = useRef(null);

  const [series, setSeries] = useState([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState(null);
  const [currentSlices, setCurrentSlices] = useState([]);

  // 3D projection image from backend
  const [threeDProjection, setThreeDProjection] = useState(null);
  
  const [displayedSlices, setDisplayedSlices] = useState({
    Axial: null, Coronal: null, Sagittal: null
  });

  const [imageTransforms, setImageTransforms] = useState({
    Axial:    { zoom: 1, rotation: 0, panX: 0, panY: 0 },
    Coronal:  { zoom: 1, rotation: 0, panX: 0, panY: 0 },
    Sagittal: { zoom: 1, rotation: 0, panX: 0, panY: 0 },
    '3D Volume': { zoom: 1, rotation: 0, panX: 0, panY: 0 },
  });

  const [activeTool, setActiveTool] = useState('select');
  const [activeImagePlane, setActiveImagePlane] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const [sliceIndices, setSliceIndices] = useState({
    Axial: 0, Coronal: 0, Sagittal: 0
  });

  // ─── 3D Rotation State ───────────────────────────────────────────────────────
  // MODIFIED: Default to 0, 0 for front-facing view (looking directly at user)
  const [threeDRotation, setThreeDRotation] = useState({ azimuth: 0, elevation: 0 });
  const [isRotating3D, setIsRotating3D] = useState(false);
  const [rotateStart, setRotateStart] = useState({ x: 0, y: 0 });

  const handle3DMouseDown = (e) => {
    setIsRotating3D(true);
    setRotateStart({ x: e.clientX, y: e.clientY });
  };

  const handle3DMouseMove = (e) => {
    if (!isRotating3D) return;
    const dx = e.clientX - rotateStart.x;
    const dy = e.clientY - rotateStart.y;

    setThreeDRotation(prev => ({
      azimuth: prev.azimuth + dx * 0.5,
      elevation: Math.max(-90, Math.min(90, prev.elevation - dy * 0.5)),
    }));
    setRotateStart({ x: e.clientX, y: e.clientY });
  };

  const handle3DMouseUp = () => {
    setIsRotating3D(false);
  };

  // ─── 3D Window State ─────────────────────────────────────────────────────────
  const [floatingWindows, setFloatingWindows] = useState({});
  const [windowOrder, setWindowOrder] = useState([]);
  const [draggingWindow, setDraggingWindow] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizingWindow, setResizingWindow] = useState(null);

  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.innerHTML = scrollbarStyles;
    document.head.appendChild(styleElement);
    fetchData();
    return () => styleElement.remove();
  }, []);

  const fetchData = () => {
    fetch('http://127.0.0.1:5000/api/patient/current')
      .then(res => res.json()).then(setPatient)
      .catch(err => console.error("Error fetching patient:", err));
    fetch('http://127.0.0.1:5000/api/study/worklist')
      .then(res => res.json()).then(setWorklist)
      .catch(err => console.error("Error fetching worklist:", err));
  };

  // Load slices when a series is selected
  useEffect(() => {
    if (!selectedSeriesId) {
      setCurrentSlices([]);
      setDisplayedSlices({ Axial: null, Coronal: null, Sagittal: null });
      setSliceIndices({ Axial: 0, Coronal: 0, Sagittal: 0 });
      setThreeDProjection(null);
      return;
    }

    fetch(`http://127.0.0.1:5000/api/series/slices/${selectedSeriesId}?azimuth=${threeDRotation.azimuth}&elevation=${threeDRotation.elevation}`)
      .then(res => res.json())
      .then(data => {
        const slices = data.slices_with_orientation || [];
        setCurrentSlices(slices);

        const axial    = slices.filter(s => s.orientation === 'Axial');
        const coronal  = slices.filter(s => s.orientation === 'Coronal');
        const sagittal = slices.filter(s => s.orientation === 'Sagittal');

        setSliceIndices({ Axial: 0, Coronal: 0, Sagittal: 0 });
        setDisplayedSlices({
          Axial:    axial.length    ? axial[Math.floor(axial.length / 2)].image    : null,
          Coronal:  coronal.length  ? coronal[Math.floor(coronal.length / 2)].image  : null,
          Sagittal: sagittal.length ? sagittal[Math.floor(sagittal.length / 2)].image : null,
        });
        setSliceIndices({
          Axial:    Math.floor(axial.length / 2),
          Coronal:  Math.floor(coronal.length / 2),
          Sagittal: Math.floor(sagittal.length / 2),
        });

        // 3D Projection from backend
        if (data.mip_3d) setThreeDProjection(data.mip_3d);
      })
      .catch(err => console.error("Error loading slices:", err));
  }, [selectedSeriesId, threeDRotation]);

  const handleFileUpload = (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) formData.append('file', files[i]);

    fetch('http://127.0.0.1:5000/api/series/upload', { method: 'POST', body: formData })
      .then(res => res.json())
      .then(data => {
        setPatient(data.patient);
        setWorklist(data.worklist);
        if (data.new_series_list) setSeries(prev => [...prev, ...data.new_series_list]);
        else if (data.new_series)  setSeries(prev => [...prev, data.new_series]);
        alert(data.message);
        if (fileInputRef.current) fileInputRef.current.value = '';
      })
      .catch(err => console.error("Upload error:", err));
  };

  const handleDelete = () => {
    if (!window.confirm("Delete all series and patient data?")) return;
    fetch('http://127.0.0.1:5000/api/series/delete', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        setPatient({}); setWorklist([]); setSeries([]);
        setSelectedSeriesId(null); setCurrentSlices([]);
        setDisplayedSlices({ Axial: null, Coronal: null, Sagittal: null });
        setThreeDProjection(null);
        alert(data.message);
      })
      .catch(err => console.error("Delete error:", err));
  };

  const handleSliceClick = (slice) => {
    const ori = slice.orientation || slice.type;
    if (['Axial', 'Coronal', 'Sagittal'].includes(ori)) {
      setDisplayedSlices(prev => ({ ...prev, [ori]: slice.image }));
    } else {
      const keys = ['Axial', 'Coronal', 'Sagittal'];
      const empty = keys.find(k => !displayedSlices[k]);
      setDisplayedSlices(prev => ({ ...prev, [empty || 'Axial']: slice.image }));
    }
  };

  // ── Image transforms ──────────────────────────────────────────────────────
  const handleZoomIn   = plane => setImageTransforms(p => ({ ...p, [plane]: { ...p[plane], zoom: Math.min(p[plane].zoom + 0.2, 3) } }));
  const handleZoomOut  = plane => setImageTransforms(p => ({ ...p, [plane]: { ...p[plane], zoom: Math.max(p[plane].zoom - 0.2, 0.5) } }));
  const handleRotate   = plane => setImageTransforms(p => ({ ...p, [plane]: { ...p[plane], rotation: (p[plane].rotation + 90) % 360 } }));
  const handleReset    = plane => setImageTransforms(p => ({ ...p, [plane]: { zoom: 1, rotation: 0, panX: 0, panY: 0 } }));

  const handleImageMouseDown = (e, plane) => {
    if (activeTool === 'select') { setIsPanning(true); setPanStart({ x: e.clientX, y: e.clientY }); }
  };
  const handleImageMouseMove = (e, plane) => {
    if (!isPanning || activeTool !== 'select') return;
    const dx = e.clientX - panStart.x, dy = e.clientY - panStart.y;
    setImageTransforms(p => ({ ...p, [plane]: { ...p[plane], panX: p[plane].panX + dx, panY: p[plane].panY + dy } }));
    setPanStart({ x: e.clientX, y: e.clientY });
  };
  const handleImageMouseUp = () => setIsPanning(false);

  const handleMouseWheel = (e, plane) => {
    e.preventDefault();
    if (plane === '3D Volume') return;   // no scrolling on 3D panel
    const slicesOfPlane = currentSlices.filter(s => s.orientation === plane);
    if (slicesOfPlane.length === 0) return;
    const cur = sliceIndices[plane];
    const newIdx = e.deltaY > 0
      ? Math.min(cur + 1, slicesOfPlane.length - 1)
      : Math.max(cur - 1, 0);
    setSliceIndices(prev => ({ ...prev, [plane]: newIdx }));
    setDisplayedSlices(prev => ({ ...prev, [plane]: slicesOfPlane[newIdx].image }));
  };

  const handleSliderChange = (e, plane) => {
    const slicesOfPlane = currentSlices.filter(s => s.orientation === plane);
    if (slicesOfPlane.length === 0) return;
    const newIdx = parseInt(e.target.value, 10);
    setSliceIndices(prev => ({ ...prev, [plane]: newIdx }));
    setDisplayedSlices(prev => ({ ...prev, [plane]: slicesOfPlane[newIdx].image }));
  };

  // ── Panel resize drag ─────────────────────────────────────────────────────
  const handleMouseDown = () => setIsDragging(true);
  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = ((e.clientX - rect.width * 0.12 - rect.left) / (rect.width * 0.88)) * 100;
      if (newWidth >= 50 && newWidth <= 90) setCenterWidth(newWidth);
    };
    const onUp = () => setIsDragging(false);
    if (isDragging) {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [isDragging]);

  // ─── Floating Window Management ──────────────────────────────────────────────
  const openFloatingWindow = (plane) => {
    const newId = `${plane}-${Date.now()}`;
    setFloatingWindows(prev => ({
      ...prev,
      [newId]: {
        id: newId,
        plane,
        x: Math.random() * 200 + 100,
        y: Math.random() * 200 + 100,
        width: 400,
        height: 400,
        isMaximized: false,
      }
    }));
    setWindowOrder(prev => [...prev, newId]);
  };

  const closeFloatingWindow = (windowId) => {
    setFloatingWindows(prev => {
      const newWindows = { ...prev };
      delete newWindows[windowId];
      return newWindows;
    });
    setWindowOrder(prev => prev.filter(id => id !== windowId));
  };

  const bringToFront = (windowId) => {
    setWindowOrder(prev => {
      const filtered = prev.filter(id => id !== windowId);
      return [...filtered, windowId];
    });
  };

  const handleWindowMouseDown = (e, windowId) => {
    if (e.target.closest('[data-no-drag]')) return;
    bringToFront(windowId);
    const window = floatingWindows[windowId];
    setDraggingWindow(windowId);
    setDragOffset({
      x: e.clientX - window.x,
      y: e.clientY - window.y,
    });
  };

  const handleWindowResizeMouseDown = (e, windowId) => {
    e.preventDefault();
    bringToFront(windowId);
    setResizingWindow(windowId);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (draggingWindow) {
        setFloatingWindows(prev => ({
          ...prev,
          [draggingWindow]: {
            ...prev[draggingWindow],
            x: e.clientX - dragOffset.x,
            y: e.clientY - dragOffset.y,
          }
        }));
      }
      if (resizingWindow) {
        const window = floatingWindows[resizingWindow];
        const newWidth = Math.max(250, e.clientX - window.x);
        const newHeight = Math.max(250, e.clientY - window.y);
        setFloatingWindows(prev => ({
          ...prev,
          [resizingWindow]: {
            ...prev[resizingWindow],
            width: newWidth,
            height: newHeight,
          }
        }));
      }
    };

    const handleMouseUp = () => {
      setDraggingWindow(null);
      setResizingWindow(null);
    };

    if (draggingWindow || resizingWindow) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingWindow, resizingWindow, dragOffset, floatingWindows]);

  const toggleMaximize = (windowId) => {
    setFloatingWindows(prev => ({
      ...prev,
      [windowId]: {
        ...prev[windowId],
        isMaximized: !prev[windowId].isMaximized,
      }
    }));
  };

  // ── Render helpers ────
  const renderNavButton = (label, icon) => (
    <Button onClick={() => setActiveNav(label)} startIcon={icon} sx={{ color: activeNav === label ? '#9cc3ff' : '#94a3b8', backgroundColor: activeNav === label ? 'rgba(30,41,59,0.7)' : 'transparent', textTransform: 'none', fontSize: '13px', fontWeight: 500, px: 2, py: 0.5, borderRadius: '6px', border: activeNav === label ? '1px solid rgba(148,163,184,0.1)' : '1px solid transparent', '&:hover': { backgroundColor: 'rgba(30,41,59,0.4)' } }}>
      {label}
    </Button>
  );

  const renderImageBox = (label) => {
    const transform = imageTransforms[label] || { zoom: 1, rotation: 0, panX: 0, panY: 0 };
    const is3D = label === '3D Volume';

    // What image to show
    const imageSrc = is3D ? threeDProjection : displayedSlices[label];

    // Slice count for slider
    const slicesOfPlane = is3D ? [] : currentSlices.filter(s => s.orientation === label);

    const imageStyle = {
      maxWidth: '100%',
      maxHeight: '100%',
      objectFit: 'contain',
      transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.zoom}) rotate(${transform.rotation}deg)`,
      transition: isPanning ? 'none' : 'transform 0.2s ease-out',
      cursor: activeTool === 'select' ? (isPanning ? 'grabbing' : 'grab') : 'default',
      userSelect: 'none',
    };

    return (
      <Box
        onMouseEnter={() => setActiveImagePlane(label)}
        onMouseLeave={() => { setActiveImagePlane(null); setIsPanning(false); }}
        onMouseDown={(e) => handleImageMouseDown(e, label)}
        onMouseMove={(e) => handleImageMouseMove(e, label)}
        onMouseUp={handleImageMouseUp}
        onWheel={(e) => handleMouseWheel(e, label)}
        onMouseDown={is3D ? handle3DMouseDown : (e) => handleImageMouseDown(e, label)}
        onMouseMove={is3D ? handle3DMouseMove : (e) => handleImageMouseMove(e, label)}
        onMouseUp={is3D ? handle3DMouseUp : handleImageMouseUp}
        sx={{
          position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center',
          background: '#000', width: '100%', height: '100%', overflow: 'hidden',
          minWidth: 0, minHeight: 0,
          cursor: is3D ? (isRotating3D ? 'grabbing' : 'grab') : (activeTool === 'select' ? (isPanning ? 'grabbing' : 'grab') : 'default'),
        }}
      >
        {/* Label */}
        <Typography variant="caption" sx={{ position: 'absolute', top: 12, left: 12, color: is3D ? '#10b981' : '#3b82f6', fontWeight: 'bold', fontSize: '13px', zIndex: 5 }}>
          {label}
        </Typography>

        {/* Hover toolbar */}
        {activeImagePlane === label && (
          <Box sx={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 0.8, backgroundColor: 'rgba(0,0,0,0.8)', padding: '8px', borderRadius: '8px', zIndex: 10, border: '1px solid rgba(79,70,229,0.3)' }}>
            <Tooltip title="Pan/Move" placement="left">
              <IconButton size="small" onClick={() => setActiveTool(activeTool === 'select' ? null : 'select')}
                sx={{ backgroundColor: activeTool === 'select' ? 'rgba(79,70,229,0.6)' : 'rgba(79,70,229,0.2)', color: '#4f46e5', '&:hover': { backgroundColor: 'rgba(79,70,229,0.5)' }, width: 32, height: 32 }}>
                <SelectIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Divider sx={{ backgroundColor: 'rgba(79,70,229,0.2)', my: 0.3 }} />
            <Tooltip title="Zoom In" placement="left">
              <IconButton size="small" onClick={() => handleZoomIn(label)}
                sx={{ backgroundColor: 'rgba(79,70,229,0.2)', color: '#4f46e5', '&:hover': { backgroundColor: 'rgba(79,70,229,0.5)' }, width: 32, height: 32 }}>
                <ZoomInIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Zoom Out" placement="left">
              <IconButton size="small" onClick={() => handleZoomOut(label)}
                sx={{ backgroundColor: 'rgba(79,70,229,0.2)', color: '#4f46e5', '&:hover': { backgroundColor: 'rgba(79,70,229,0.5)' }, width: 32, height: 32 }}>
                <ZoomOutIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Rotate 90°" placement="left">
              <IconButton size="small" onClick={() => handleRotate(label)}
                sx={{ backgroundColor: 'rgba(79,70,229,0.2)', color: '#4f46e5', '&:hover': { backgroundColor: 'rgba(79,70,229,0.5)' }, width: 32, height: 32 }}>
                <RotateRightIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Divider sx={{ backgroundColor: 'rgba(79,70,229,0.2)', my: 0.3 }} />
            <Tooltip title="Reset" placement="left">
              <IconButton size="small" onClick={() => handleReset(label)}
                sx={{ backgroundColor: 'rgba(79,70,229,0.2)', color: '#4f46e5', '&:hover': { backgroundColor: 'rgba(79,70,229,0.5)' }, width: 32, height: 32 }}>
                <RefreshIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Open in Floating Window" placement="left">
              <IconButton size="small" onClick={() => openFloatingWindow(label)}
                sx={{ backgroundColor: 'rgba(79,70,229,0.2)', color: '#4f46e5', '&:hover': { backgroundColor: 'rgba(79,70,229,0.5)' }, width: 32, height: 32 }}>
                <ExpandIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}

        {/* Zoom indicator */}
        {transform.zoom !== 1 && (
          <Box sx={{ position: 'absolute', bottom: 10, left: 12, backgroundColor: 'rgba(0,0,0,0.8)', px: 1.2, py: 0.6, borderRadius: '4px', zIndex: 10, border: '1px solid rgba(79,70,229,0.3)' }}>
            <Typography variant="caption" sx={{ fontSize: '11px', color: '#e2e8f0', fontWeight: 500 }}>
              {(transform.zoom * 100).toFixed(0)}%
            </Typography>
          </Box>
        )}

        {/* Slice counter (bottom right) */}
        {!is3D && slicesOfPlane.length > 1 && (
          <Box sx={{ position: 'absolute', bottom: 10, right: 28, backgroundColor: 'rgba(0,0,0,0.7)', px: 1, py: 0.4, borderRadius: '4px', zIndex: 9 }}>
            <Typography variant="caption" sx={{ fontSize: '10px', color: '#94a3b8' }}>
              {sliceIndices[label] + 1} / {slicesOfPlane.length}
            </Typography>
          </Box>
        )}

        {/* Vertical scroll slider */}
        {!is3D && slicesOfPlane.length > 1 && (
          <Box sx={{ position: 'absolute', right: 0, top: 0, width: '20px', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)', borderLeft: '1px solid rgba(79,70,229,0.2)', zIndex: 8 }}>
            <input
              type="range" min="0" max={slicesOfPlane.length - 1} value={sliceIndices[label]}
              onChange={(e) => handleSliderChange(e, label)}
              style={{ width: '100%', height: '100%', appearance: 'slider-vertical', WebkitAppearance: 'slider-vertical', writingMode: 'bt-lr', cursor: 'pointer', opacity: 0.7 }}
            />
          </Box>
        )}

        {/* Image or placeholder */}
        <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 1 }}>
          {imageSrc ? (
            <img src={imageSrc} alt={label} style={imageStyle} draggable={false} />
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="textSecondary">
                {is3D ? '[ 3D Projection renders after upload ]' : `[ ${label} ]`}
              </Typography>
              {is3D && (
                <Typography variant="caption" sx={{ color: '#334155', fontSize: '10px', textAlign: 'center', maxWidth: '200px' }}>
                  Upload a CT series to generate axial, coronal, sagittal views and a 3D projection
                </Typography>
              )}
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  const renderFloatingWindow = (windowId) => {
    const window = floatingWindows[windowId];
    if (!window) return null;

    const transform = imageTransforms[window.plane] || { zoom: 1, rotation: 0, panX: 0, panY: 0 };
    const is3D = window.plane === '3D Volume';
    const imageSrc = is3D ? threeDProjection : displayedSlices[window.plane];
    const slicesOfPlane = is3D ? [] : currentSlices.filter(s => s.orientation === window.plane);

    const imageStyle = {
      maxWidth: '100%',
      maxHeight: '100%',
      objectFit: 'contain',
      transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.zoom}) rotate(${transform.rotation}deg)`,
      transition: 'none',
      cursor: activeTool === 'select' ? (isPanning ? 'grabbing' : 'grab') : 'default',
      userSelect: 'none',
    };

    const zIndex = windowOrder.indexOf(windowId) + 1000;
    const isMaximized = window.isMaximized;

    return (
      <Box
        key={windowId}
        onMouseDown={(e) => handleWindowMouseDown(e, windowId)}
        sx={{
          position: 'fixed',
          left: isMaximized ? 0 : window.x,
          top: isMaximized ? 56 : window.y,
          width: isMaximized ? '100vw' : window.width,
          height: isMaximized ? 'calc(100vh - 56px)' : window.height,
          backgroundColor: '#0b0f19',
          border: '1px solid rgba(79,70,229,0.3)',
          borderRadius: isMaximized ? 0 : '8px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          zIndex,
          transition: isMaximized ? 'all 0.3s ease' : 'none',
        }}
      >
        {/* Title Bar */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#070913',
            borderBottom: '1px solid rgba(79,70,229,0.2)',
            px: 2,
            py: 1,
            cursor: 'grab',
            userSelect: 'none',
            '&:active': { cursor: 'grabbing' },
          }}
          data-no-drag={false}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#e2e8f0', fontSize: '13px' }}>
            {window.plane}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }} data-no-drag>
            <Tooltip title="Maximize">
              <IconButton size="small" onClick={() => toggleMaximize(windowId)}
                sx={{ color: '#4f46e5', '&:hover': { backgroundColor: 'rgba(79,70,229,0.2)' }, width: 28, height: 28 }}>
                <FullscreenIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Close">
              <IconButton size="small" onClick={() => closeFloatingWindow(windowId)}
                sx={{ color: '#ef4444', '&:hover': { backgroundColor: 'rgba(239,68,68,0.2)' }, width: 28, height: 28 }}>
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Content */}
        <Box
          onMouseDown={is3D ? handle3DMouseDown : (e) => handleImageMouseDown(e, window.plane)}
          onMouseMove={is3D ? handle3DMouseMove : (e) => handleImageMouseMove(e, window.plane)}
          onMouseUp={is3D ? handle3DMouseUp : handleImageMouseUp}
          onWheel={(e) => handleMouseWheel(e, window.plane)}
          sx={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            background: '#000',
            overflow: 'hidden',
            position: 'relative',
          }}
          data-no-drag
        >
          {imageSrc ? (
            <img src={imageSrc} alt={window.plane} style={imageStyle} draggable={false} />
          ) : (
            <Typography variant="body2" color="textSecondary">
              No image available
            </Typography>
          )}

          {/* Floating Window Toolbar */}
          <Box sx={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 0.5, backgroundColor: 'rgba(0,0,0,0.8)', padding: '6px', borderRadius: '6px', zIndex: 10, border: '1px solid rgba(79,70,229,0.3)' }}>
            <Tooltip title="Zoom In" placement="left">
              <IconButton size="small" onClick={() => handleZoomIn(window.plane)}
                sx={{ backgroundColor: 'rgba(79,70,229,0.2)', color: '#4f46e5', '&:hover': { backgroundColor: 'rgba(79,70,229,0.5)' }, width: 28, height: 28 }}>
                <ZoomInIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Zoom Out" placement="left">
              <IconButton size="small" onClick={() => handleZoomOut(window.plane)}
                sx={{ backgroundColor: 'rgba(79,70,229,0.2)', color: '#4f46e5', '&:hover': { backgroundColor: 'rgba(79,70,229,0.5)' }, width: 28, height: 28 }}>
                <ZoomOutIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Rotate 90°" placement="left">
              <IconButton size="small" onClick={() => handleRotate(window.plane)}
                sx={{ backgroundColor: 'rgba(79,70,229,0.2)', color: '#4f46e5', '&:hover': { backgroundColor: 'rgba(79,70,229,0.5)' }, width: 28, height: 28 }}>
                <RotateRightIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Reset" placement="left">
              <IconButton size="small" onClick={() => handleReset(window.plane)}
                sx={{ backgroundColor: 'rgba(79,70,229,0.2)', color: '#4f46e5', '&:hover': { backgroundColor: 'rgba(79,70,229,0.5)' }, width: 28, height: 28 }}>
                <RefreshIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>

          {/* Zoom Indicator */}
          {transform.zoom !== 1 && (
            <Box sx={{ position: 'absolute', bottom: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.8)', px: 1, py: 0.4, borderRadius: '4px', zIndex: 10, border: '1px solid rgba(79,70,229,0.3)' }}>
              <Typography variant="caption" sx={{ fontSize: '10px', color: '#e2e8f0', fontWeight: 500 }}>
                {(transform.zoom * 100).toFixed(0)}%
              </Typography>
            </Box>
          )}
        </Box>

        {/* Resize Handle */}
        {!isMaximized && (
          <Box
            onMouseDown={(e) => handleWindowResizeMouseDown(e, windowId)}
            sx={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: '20px',
              height: '20px',
              backgroundColor: 'rgba(79,70,229,0.3)',
              cursor: 'nwse-resize',
              borderRadius: '0 0 8px 0',
            }}
          />
        )}
      </Box>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden', backgroundColor: '#070913' }}>

        {/* HEADER */}
        <Box sx={{ height: '56px', px: 3, backgroundColor: '#090d16', borderBottom: '1px solid #161c2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,#818cf8 0%,#c084fc 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#090d16' }} />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '18px', color: '#ffffff' }}>abdora</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {renderNavButton('Viewer',        <VisibilityIcon sx={{ fontSize: 18 }} />)}
            {renderNavButton('AI Analysis',   <AutoGraphIcon  sx={{ fontSize: 18 }} />)}
            {renderNavButton('Reporting',     <AssignmentIcon sx={{ fontSize: 18 }} />)}
            {renderNavButton('Patient Data',  <AccountCircleIcon sx={{ fontSize: 18 }} />)}
            {renderNavButton('Workflow',      <AccountTreeIcon sx={{ fontSize: 18 }} />)}
            {renderNavButton('Explainability',<PsychologyIcon sx={{ fontSize: 18 }} />)}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton size="small" sx={{ color: '#94a3b8' }}><NotificationsNoneIcon sx={{ fontSize: 20 }} /></IconButton>
            <IconButton size="small" sx={{ color: '#94a3b8' }}><SettingsOutlinedIcon  sx={{ fontSize: 20 }} /></IconButton>
            <IconButton size="small" sx={{ color: '#94a3b8' }}><HelpOutlineIcon       sx={{ fontSize: 20 }} /></IconButton>
            <Divider orientation="vertical" variant="middle" flexItem sx={{ borderColor: '#161c2e', mx: 1 }} />
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '13px', color: '#fff' }}>Dr. Sarah Khan</Typography>
              <Typography variant="caption" sx={{ color: '#64748b', fontSize: '11px' }}>Radiologist</Typography>
            </Box>
            <Avatar sx={{ width: 32, height: 32, bgcolor: '#334155', fontSize: '13px' }}>SK</Avatar>
          </Box>
        </Box>

        {/* BODY */}
        <Box ref={containerRef} sx={{ display: 'flex', flexGrow: 1, height: 'calc(100vh - 56px)', overflow: 'hidden', width: '100%', userSelect: isDragging ? 'none' : 'auto' }}>

          {/* LEFT PANEL */}
          <Box sx={{ width: '12%', borderRight: '1px solid #161c2e', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', overflowY: 'auto', flexShrink: 0, backgroundColor: '#070913' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <Avatar sx={{ width: 56, height: 56, bgcolor: patient.name && patient.name !== 'Unknown Patient' ? '#4f46e5' : '#1e293b', fontSize: '24px', fontWeight: 'bold', border: patient.name && patient.name !== 'Unknown Patient' ? '2px solid #4f46e5' : '2px solid #334155' }}>
                {patient.name && patient.name !== 'Unknown Patient' ? patient.name.split(' ').map(n => n[0]).join('') : '?'}
              </Avatar>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '13px', color: '#fff' }}>{patient.name || 'No Patient'}</Typography>
                <Typography variant="caption" sx={{ fontSize: '11px', color: '#64748b' }}>MRN: {patient.mrn || '---'}</Typography>
              </Box>
            </Box>
            <Divider sx={{ borderColor: '#161c2e' }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
              <Typography variant="caption" sx={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Details</Typography>
              <Typography variant="caption" sx={{ fontSize: '11px', color: '#cbd5e1' }}>
                <b>{patient.gender || '---'}</b> • {patient.age || '---'} • {patient.dob || '---'}
              </Typography>
            </Box>
            <Divider sx={{ borderColor: '#161c2e' }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="caption" sx={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Study Worklist</Typography>
              <List dense sx={{ p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {worklist.map((study) => (
                  <ListItem key={study.id} button selected={study.current}
                    sx={{ p: 1, borderRadius: 1, backgroundColor: study.current ? 'rgba(79,70,229,0.12)' : 'transparent', border: study.current ? '1px solid rgba(79,70,229,0.3)' : '1px solid transparent', display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <Typography variant="caption" sx={{ fontSize: '11px', fontWeight: 500, color: '#e2e8f0' }}>{study.type}</Typography>
                      <Typography variant="caption" sx={{ fontSize: '9px', color: '#64748b' }}>{study.date}</Typography>
                    </Box>
                    <Typography variant="caption" sx={{ fontSize: '10px', color: '#94a3b8' }}>{study.time}</Typography>
                  </ListItem>
                ))}
              </List>
            </Box>
          </Box>

          {/* CENTER PANEL */}
          <Box sx={{ width: `${centerWidth}%`, height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#070913', transition: isDragging ? 'none' : 'width 0.1s ease-out', overflow: 'hidden' }}>

            {/* TOP ROW: Axial + Coronal */}
            <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
              <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>{renderImageBox('Axial')}</Box>
              <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, borderLeft: '1px solid #161c2e' }}>{renderImageBox('Coronal')}</Box>
            </Box>

            {/* BOTTOM ROW: Sagittal + 3D Volume */}
            <Box sx={{ display: 'flex', flex: 1, minHeight: 0, borderTop: '1px solid #161c2e' }}>
              <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>{renderImageBox('Sagittal')}</Box>
              <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, borderLeft: '1px solid #161c2e' }}>{renderImageBox('3D Volume')}</Box>
            </Box>

            {/* BOTTOM TRAY */}
            <Box sx={{ height: 120, display: 'flex', alignItems: 'center', gap: 1.5, backgroundColor: '#0b0f19', p: 1.5, borderTop: '1px solid #161c2e', width: '100%', flexShrink: 0, overflowX: 'auto' }}>

              {/* Series thumbnails */}
              {series.map((s) => (
                <Box key={s.id} onClick={() => setSelectedSeriesId(s.id)}
                  sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, p: 1, borderRadius: 1, minWidth: '80px', cursor: 'pointer', backgroundColor: selectedSeriesId === s.id ? 'rgba(79,70,229,0.2)' : 'transparent', border: selectedSeriesId === s.id ? `2px solid ${s.color}` : '1px solid #334155' }}>
                  <Box sx={{ width: '60px', height: '60px', backgroundColor: '#1e293b', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px dashed ${s.color}`, overflow: 'hidden' }}>
                    {s.thumbnail ? <img src={s.thumbnail} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Typography variant="caption" sx={{ fontSize: '9px', color: s.color, fontWeight: 600 }}>{s.type}</Typography>}
                  </Box>
                  <Typography variant="caption" sx={{ fontSize: '10px', color: '#e2e8f0' }}>{s.name}</Typography>
                  <Typography variant="caption" sx={{ fontSize: '9px', color: '#64748b' }}>{s.count} slices</Typography>
                </Box>
              ))}

              {/* Slice thumbnails from selected series */}
              {selectedSeriesId && currentSlices
                .filter((_, i) => i % Math.max(1, Math.floor(currentSlices.length / 40)) === 0)  // max ~40 thumbnails
                .map((slice, idx) => (
                  <Box key={idx} onClick={() => handleSliceClick(slice)}
                    sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, p: 0.8, borderRadius: 1, minWidth: '70px', cursor: 'pointer', backgroundColor: 'rgba(79,70,229,0.1)', border: '1px solid #334155', '&:hover': { borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,0.2)' } }}>
                    <Box sx={{ width: '50px', height: '50px', backgroundColor: '#1e293b', borderRadius: '4px', overflow: 'hidden' }}>
                      <img src={slice.image} alt={`Slice ${idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </Box>
                    <Typography variant="caption" sx={{ fontSize: '8px', color: '#94a3b8' }}>
                      {slice.orientation || `S${idx + 1}`}
                    </Typography>
                  </Box>
                ))}

              {/* Add Series */}
              <Button component="label"
                sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, p: 1, minWidth: '80px', borderRadius: 1, border: '2px dashed #334155', color: '#94a3b8', textTransform: 'none' }}>
                <AddIcon sx={{ fontSize: 28 }} />
                <Typography variant="caption" sx={{ fontSize: '10px' }}>Add Series</Typography>
                <input type="file" ref={fileInputRef} hidden onChange={handleFileUpload} webkitdirectory="" directory="" multiple />
              </Button>

              {/* Clear All */}
              {series.length > 0 && (
                <Button onClick={handleDelete}
                  sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, p: 1, minWidth: '80px', borderRadius: 1, border: '1px solid #ef4444', color: '#ef4444', textTransform: 'none', ml: 'auto' }}>
                  <DeleteIcon sx={{ fontSize: 28 }} />
                  <Typography variant="caption" sx={{ fontSize: '10px' }}>Clear All</Typography>
                </Button>
              )}
            </Box>
          </Box>

          {/* RESIZER */}
          <Box onMouseDown={handleMouseDown}
            sx={{ width: '6px', height: '100%', backgroundColor: isDragging ? '#4f46e5' : '#161c2e', cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <DragIndicatorIcon sx={{ fontSize: 16, color: isDragging ? '#fff' : '#64748b' }} />
          </Box>

          {/* RIGHT PANEL */}
          <Box sx={{ width: `${100 - centerWidth}%`, display: 'flex', flexDirection: 'column', backgroundColor: '#0b0f19', overflow: 'hidden' }}>
            <Box sx={{ backgroundColor: '#070913', borderBottom: '1px solid #161c2e', px: 2 }}>
              <Tabs value={rightTab} onChange={(e, v) => setRightTab(v)} variant="fullWidth">
                <Tab label="AI Findings" />
                <Tab label="Report" />
                <Tab label="Prior Comparison" />
              </Tabs>
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="subtitle2" sx={{ fontSize: '11px', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase' }}>AI Findings Summary</Typography>
              <Typography variant="body2" sx={{ fontSize: '13px', color: '#64748b', textAlign: 'center', py: 2 }}>
                {series.length > 0 ? 'AI results pending…' : 'No series uploaded.'}
              </Typography>
            </Box>
          </Box>

        </Box>

        {/* Floating Windows Container */}
        {windowOrder.map(windowId => renderFloatingWindow(windowId))}
      </Box>
    </ThemeProvider>
  );
}

export default App;
