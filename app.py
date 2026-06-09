from flask import Flask, jsonify, request
from flask_cors import CORS
import pydicom
import numpy as np
from PIL import Image
import io
import base64
import datetime
from scipy.ndimage import rotate, zoom, gaussian_filter

app = Flask(__name__)
CORS(app)

# ─── Helpers ────────────────────────────────────────────────────────────────

def format_dicom_date(date_str):
    if not date_str or date_str in ("None", ""): return "N/A"
    try: return datetime.datetime.strptime(date_str, "%Y%m%d").strftime("%d %b %Y")
    except: return date_str

def format_dicom_time(time_str):
    if not time_str or time_str in ("None", ""): return "N/A"
    try:
        return datetime.datetime.strptime(time_str.split(".")[0], "%H%M%S").strftime("%I:%M %p")
    except: return time_str

def apply_windowing(arr, window_center, window_width, rescale_intercept=0, rescale_slope=1):
    hu = arr * rescale_slope + rescale_intercept
    img_min = window_center - window_width // 2
    img_max = window_center + window_width // 2
    windowed = np.clip(hu, img_min, img_max)
    windowed = ((windowed - img_min) / (img_max - img_min) * 255.0).astype(np.uint8)
    return windowed

def array_to_base64(arr, size=(512, 512)):
    if arr.dtype != np.uint8:
        arr = arr.astype(np.uint8)
    img = Image.fromarray(arr, mode='L')
    if img.size[0] > size[0] or img.size[1] > size[1]:
        img.thumbnail(size, Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"

def build_mpr_slices(volume_3d, pixel_spacing, slice_thickness, window_center, window_width, rescale_intercept, rescale_slope):
    Z, Y, X = volume_3d.shape
    ps_y = float(pixel_spacing[0]) if pixel_spacing else 1.0
    ps_x = float(pixel_spacing[1]) if pixel_spacing else 1.0
    st   = float(slice_thickness)  if slice_thickness  else 1.0

    def resize_to_aspect(arr_2d, aspect):
        h, w = arr_2d.shape
        new_h = max(1, int(round(h * aspect)))
        img = Image.fromarray(arr_2d)
        img = img.resize((w, new_h), Image.BILINEAR)
        return np.array(img)

    axial_slices, coronal_slices, sagittal_slices = [], [], []

    for z in range(Z):
        frame = volume_3d[z, :, :]
        windowed = apply_windowing(frame, window_center, window_width, rescale_intercept, rescale_slope)
        axial_slices.append({"image": array_to_base64(windowed), "orientation": "Axial", "index": z})

    cor_aspect = st / ps_x
    for y in range(Y):
        frame = volume_3d[::-1, y, :]
        windowed = apply_windowing(frame, window_center, window_width, rescale_intercept, rescale_slope)
        resized = resize_to_aspect(windowed, cor_aspect)
        coronal_slices.append({"image": array_to_base64(resized), "orientation": "Coronal", "index": y})

    sag_aspect = st / ps_y
    for x in range(X):
        frame = volume_3d[::-1, :, x]
        windowed = apply_windowing(frame, window_center, window_width, rescale_intercept, rescale_slope)
        resized = resize_to_aspect(windowed, sag_aspect)
        sagittal_slices.append({"image": array_to_base64(resized), "orientation": "Sagittal", "index": x})

    return axial_slices, coronal_slices, sagittal_slices

from scipy.ndimage import zoom, gaussian_filter, binary_erosion
import numpy as np
from PIL import Image
import io, base64

def build_3d_projection(volume_3d, pixel_spacing, slice_thickness,
                        window_center, window_width,
                        rescale_intercept, rescale_slope, azimuth=0, elevation=0):
    """
    ENHANCED Professional Transfer-Function Volume Renderer.
    
    IMPROVEMENTS:
    - Default azimuth=0, elevation=0 for front-facing view (looking directly at user)
    - Enhanced opacity transfer function for better tissue visibility
    - Improved lighting with stronger ambient component
    - Better contrast and color saturation
    - Higher ray-marching step count for smoother rendering
    - Enhanced specular highlights for anatomical detail
    
    Tissues classified by HU → each gets its own RGBA colour + opacity.
    Ray-marching with front-to-back alpha compositing + Phong shading.
    Output: colour PNG matching clinical viewer quality.
    """
    ps_x = float(pixel_spacing[1]) if pixel_spacing else 1.0
    st   = float(slice_thickness)  if slice_thickness else 1.0

    # ── 1. Isotropic resample (cap to avoid OOM) ──────────────────────────────
    zoom_z = min(st / ps_x, 2.0)
    vol = zoom(volume_3d, (zoom_z, 1, 1), order=1).astype(np.float32)

    # ── 2. HU conversion ──────────────────────────────────────────────────────
    hu = vol * float(rescale_slope) + float(rescale_intercept)
    hu = np.clip(hu, -1024, 3000)

    Z, Y, X = hu.shape

    # ── 3. Smooth for stable normals ──────────────────────────────────────────
    smoothed = gaussian_filter(hu, sigma=0.6)
    gz, gy, gx = np.gradient(smoothed)
    grad_mag = np.sqrt(gx**2 + gy**2 + gz**2) + 1e-6
    nx = (gx / grad_mag).astype(np.float32)
    ny = (gy / grad_mag).astype(np.float32)
    nz = (gz / grad_mag).astype(np.float32)

    # ── 4. ENHANCED Transfer function: HU → (R, G, B, alpha) ──────────────────
    # MODIFIED: Increased opacity values for better visibility
    # Modelled after clinical presets in OsiriX / 3D Slicer with enhanced clarity
    #
    #  HU range        | Tissue          | Colour (linear 0-1)      | Opacity (ENHANCED)
    #  -1000 → -600    | Air             | transparent              | 0.00
    #  -600  → -100    | Lung / fat      | very faint yellow        | 0.05
    #  -100  →   40    | Soft tissue     | warm salmon/pink         | 0.25
    #    40  →  130    | Organs / muscle | deeper red-orange        | 0.40
    #   130  →  400    | Cartilage / dense| pale ivory              | 0.65
    #   400  → 1000    | Bone (cortical) | bright warm white-cream  | 0.95
    #  1000  → 3000    | Dense bone/metal| pure white               | 1.00

    def tf_rgba(hu_val):
        """Return (r,g,b,a) arrays for the full volume in one pass."""
        r = np.zeros_like(hu_val)
        g = np.zeros_like(hu_val)
        b = np.zeros_like(hu_val)
        a = np.zeros_like(hu_val)

        def lerp(arr, lo, hi, v0, v1):
            t = np.clip((arr - lo) / (hi - lo + 1e-6), 0, 1)
            return v0 + t * (v1 - v0)

        # Soft tissue: salmon pink (ENHANCED opacity)
        m = (hu_val >= -100) & (hu_val < 40)
        r[m] = lerp(hu_val[m], -100, 40, 0.75, 0.85)
        g[m] = lerp(hu_val[m], -100, 40, 0.45, 0.55)
        b[m] = lerp(hu_val[m], -100, 40, 0.38, 0.45)
        a[m] = lerp(hu_val[m], -100, 40, 0.12, 0.25)  # ENHANCED from 0.08-0.18

        # Organs / muscle: deeper red-orange (ENHANCED opacity)
        m = (hu_val >= 40) & (hu_val < 130)
        r[m] = lerp(hu_val[m], 40, 130, 0.82, 0.88)
        g[m] = lerp(hu_val[m], 40, 130, 0.35, 0.42)
        b[m] = lerp(hu_val[m], 40, 130, 0.22, 0.28)
        a[m] = lerp(hu_val[m], 40, 130, 0.25, 0.40)  # ENHANCED from 0.18-0.30

        # Cartilage / dense soft: ivory (ENHANCED opacity)
        m = (hu_val >= 130) & (hu_val < 400)
        r[m] = lerp(hu_val[m], 130, 400, 0.88, 0.95)
        g[m] = lerp(hu_val[m], 130, 400, 0.80, 0.90)
        b[m] = lerp(hu_val[m], 130, 400, 0.68, 0.80)
        a[m] = lerp(hu_val[m], 130, 400, 0.40, 0.65)  # ENHANCED from 0.30-0.55

        # Cortical bone: warm cream-white (ENHANCED opacity)
        m = (hu_val >= 400) & (hu_val < 1000)
        r[m] = lerp(hu_val[m], 400, 1000, 0.95, 1.00)
        g[m] = lerp(hu_val[m], 400, 1000, 0.90, 0.96)
        b[m] = lerp(hu_val[m], 400, 1000, 0.78, 0.88)
        a[m] = lerp(hu_val[m], 400, 1000, 0.65, 0.95)  # ENHANCED from 0.55-0.92

        # Dense bone / metal: pure white
        m = hu_val >= 1000
        r[m] = 1.0; g[m] = 1.0; b[m] = 1.0
        a[m] = 1.0

        return r, g, b, a

    # ── 5. Camera / rotation setup ────────────────────────────────────────────
    # MODIFIED: Default to 0, 0 for front-facing view
    az = np.radians(azimuth)   # azimuth (left-right spin) - DEFAULT 0 = front view
    el = np.radians(elevation)   # elevation (tilt down) - DEFAULT 0 = level view

    Rx = np.array([[1,          0,           0],
                   [0, np.cos(el), -np.sin(el)],
                   [0, np.sin(el),  np.cos(el)]], dtype=np.float32)
    Ry = np.array([[ np.cos(az), 0, np.sin(az)],
                   [0,           1,          0],
                   [-np.sin(az), 0, np.cos(az)]], dtype=np.float32)
    R = (Ry @ Rx).T   # we use R.T to go camera→volume

    cx, cy, cz = X / 2.0, Y / 2.0, Z / 2.0

    out_h, out_w = 1024, 1024
    # ── 6. ENHANCED Light directions for Phong ───────────────────────────────
    # MODIFIED: Stronger primary light for better illumination
    L1 = np.array([0.7,  0.85,  0.8], dtype=np.float32)  # ENHANCED: stronger front light
    L1 /= np.linalg.norm(L1)
    L2 = np.array([-0.5, -0.3, 0.7], dtype=np.float32)  # ENHANCED: stronger fill light
    L2 /= np.linalg.norm(L2)

    # ── 7. Ray-march with front-to-back alpha compositing ─────────────────────
    # Pixel grid in camera space
    px = np.linspace(-X / 2.0, X / 2.0, out_w, dtype=np.float32)
    py = np.linspace(-Y / 2.0, Y / 2.0, out_h, dtype=np.float32)
    grid_x, grid_y = np.meshgrid(px, py)  # (H, W)

    # Accumulators: RGBA composited image
    acc_r = np.zeros((out_h, out_w), dtype=np.float32)
    acc_g = np.zeros((out_h, out_w), dtype=np.float32)
    acc_b = np.zeros((out_h, out_w), dtype=np.float32)
    acc_a = np.zeros((out_h, out_w), dtype=np.float32)   # total opacity so far

    depth_range = float(max(Z, Y, X)) * 1.8
    n_steps     = 400   # ENHANCED: increased from 300 for smoother rendering
    step_size   = depth_range / n_steps

    for step in range(n_steps):
        # Early termination when all pixels are fully opaque
        if (acc_a > 0.98).all():
            break

        t      = (step + 0.5) * step_size
        cam_z  = t - depth_range / 2.0

        # Camera → volume coordinates for every pixel
        vx = R[0,0]*grid_x + R[0,1]*grid_y + R[0,2]*cam_z + cx
        vy = R[1,0]*grid_x + R[1,1]*grid_y + R[1,2]*cam_z + cy
        vz = R[2,0]*grid_x + R[2,1]*grid_y + R[2,2]*cam_z + cz

        in_b = ((vx >= 0) & (vx < X-1) &
                (vy >= 0) & (vy < Y-1) &
                (vz >= 0) & (vz < Z-1))
        active = in_b & (acc_a < 0.98)
        if not active.any():
            continue

        ix = vx[active].astype(np.int32)
        iy = vy[active].astype(np.int32)
        iz = vz[active].astype(np.int32)

        ix = np.clip(ix, 0, X-1)
        iy = np.clip(iy, 0, Y-1)
        iz = np.clip(iz, 0, Z-1)

        # Sample HU + transfer function
        hu_s = hu[iz, iy, ix]
        tr, tg, tb, ta = tf_rgba(hu_s)

        # Skip near-transparent samples (air, background)
        contrib = ta > 0.01
        if not contrib.any():
            continue

        # Phong shading for contributing samples
        snx = nx[iz, iy, ix]
        sny = ny[iz, iy, ix]
        snz = nz[iz, iy, ix]

        # ENHANCED: Stronger ambient + diffuse lighting
        d1 = np.clip(snx*L1[0] + sny*L1[1] + snz*L1[2], 0, 1)
        d2 = np.clip(snx*L2[0] + sny*L2[1] + snz*L2[2], 0, 1)

        # Specular (ENHANCED for better detail)
        dot_ln = np.clip(snx*L1[0] + sny*L1[1] + snz*L1[2], 0, 1)
        spec   = np.clip(2*dot_ln*snz - L1[2], 0, 1) ** 18  # ENHANCED: sharper specular

        # ENHANCED: Stronger ambient component + better shading
        shade = np.clip(
                0.15 + 0.70*d1 + 0.15*d2 + 0.35*spec,
                0, 1
            )

        tr = np.clip(tr * shade, 0, 1)
        tg = np.clip(tg * shade, 0, 1)
        tb = np.clip(tb * shade, 0, 1)

        # Front-to-back alpha compositing
        # C_out = C_in + (1 - alpha_in) * alpha_sample * C_sample
        remaining = 1.0 - acc_a[active]
        contrib_w = remaining * ta

        acc_r[active] += contrib_w * tr
        acc_g[active] += contrib_w * tg
        acc_b[active] += contrib_w * tb
        acc_a[active] += contrib_w

    # ── 8. ENHANCED Tone-map + gamma correction ──────────────────────────────
    # MODIFIED: Better contrast and saturation
    def norm(ch):
        mx = ch.max()
        return ch / mx if mx > 0 else ch

    # ENHANCED: Stronger gamma for better contrast
    R_out = np.clip(norm(acc_r), 0, 1) ** 0.75  # ENHANCED from 0.85
    G_out = np.clip(norm(acc_g), 0, 1) ** 0.75  # ENHANCED from 0.85
    B_out = np.clip(norm(acc_b), 0, 1) ** 0.75  # ENHANCED from 0.85
    A_out = np.clip(acc_a,       0, 1)

    # ── 9. Compose onto black background + encode as PNG ─────────────────────
    rgb = np.stack([
        (R_out * A_out * 255).astype(np.uint8),
        (G_out * A_out * 255).astype(np.uint8),
        (B_out * A_out * 255).astype(np.uint8),
    ], axis=-1)

    img = Image.fromarray(rgb, mode='RGB')
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"

# ─── Global state ────────────────────────────────────────────────────────────
stored_patients, stored_worklist, stored_series_meta, series_counter = {}, [], {}, [0]

# ─── Routes ──────────────────────────────────────────────────────────────────
@app.route('/api/patient/current', methods=['GET'])
def get_current_patient(): return jsonify(stored_patients)

@app.route('/api/study/worklist', methods=['GET'])
def get_study_worklist(): return jsonify(stored_worklist)

@app.route("/api/series/slices/<int:series_id>", methods=["GET"])
def get_series_slices(series_id):
    # MODIFIED: Default to 0, 0 for front-on view (looking directly at user)
    azimuth = request.args.get("azimuth", type=float, default=0)
    elevation = request.args.get("elevation", type=float, default=0)
    meta = stored_series_meta.get(str(series_id))
    if not meta: return jsonify({"series_id": series_id, "slices": [], "slices_with_orientation": []}), 404
    all_slices = meta["axial_slices"] + meta["coronal_slices"] + meta["sagittal_slices"]
    return jsonify({"series_id": series_id, "slices": [s["image"] for s in all_slices], "slices_with_orientation": all_slices, "mip_3d": build_3d_projection(meta["volume_3d"], meta["pixel_spacing"], meta["slice_thickness"],
                                        meta["window_center"], meta["window_width"],
                                        meta["rescale_intercept"], meta["rescale_slope"],
                                        azimuth=azimuth, elevation=elevation)})

@app.route('/api/series/delete', methods=['POST'])
def delete_all_data():
    global stored_patients, stored_worklist, stored_series_meta
    stored_patients, stored_worklist, stored_series_meta, series_counter[0] = {}, [], {}, 0
    return jsonify({"message": "All data cleared successfully"})

@app.route('/api/series/upload', methods=['POST'])
def upload_series():
    global stored_patients, stored_worklist, stored_series_meta
    files = request.files.getlist('file')
    if not files: return jsonify({"error": "No files uploaded"}), 400
    raw_slices = []
    for file in files:
        try:
            ds = pydicom.dcmread(file.stream)
            if 'PixelData' not in ds: continue
            if not stored_patients:
                p_name = str(getattr(ds, 'PatientName', 'Unknown Patient')).replace('^', ' ').strip()
                stored_patients = {"name": p_name or "Unknown Patient", "mrn": str(getattr(ds, 'PatientID', 'N/A')).strip(), "gender": str(getattr(ds, 'PatientSex', 'N/A')).strip(), "age": str(getattr(ds, 'PatientAge', 'N/A')).strip(), "dob": format_dicom_date(str(getattr(ds, 'PatientBirthDate', ''))), "referring_physician": str(getattr(ds, 'ReferringPhysicianName', '')).replace('^', ' ').strip(), "priority": "Medium"}
            wc = getattr(ds, 'WindowCenter', 40)
            ww = getattr(ds, 'WindowWidth', 400)
            if isinstance(wc, pydicom.multival.MultiValue): wc = wc[0]
            if isinstance(ww, pydicom.multival.MultiValue): ww = ww[0]
            raw_slices.append({"instance": int(getattr(ds, 'InstanceNumber', 0)), "series_uid": str(getattr(ds, 'SeriesInstanceUID', 'unknown')), "pixel_array": ds.pixel_array.astype(np.float32), "pixel_spacing": getattr(ds, 'PixelSpacing', [1.0, 1.0]), "slice_thickness": float(getattr(ds, 'SliceThickness', 1.0)), "modality": str(getattr(ds, 'Modality', 'CT')), "study_desc": str(getattr(ds, 'StudyDescription', 'Study')), "date": format_dicom_date(str(getattr(ds, 'StudyDate', ''))), "time": format_dicom_time(str(getattr(ds, 'StudyTime', ''))), "slice_location": float(getattr(ds, 'SliceLocation', getattr(ds, 'InstanceNumber', 0))), "window_center": float(wc), "window_width": float(ww), "rescale_intercept": float(getattr(ds, 'RescaleIntercept', 0)), "rescale_slope": float(getattr(ds, 'RescaleSlope', 1))})
        except Exception as e: print(f"[WARN] Error reading file: {e}")
    if not raw_slices: return jsonify({"error": "No valid DICOM pixel data found"}), 400
    series_groups = {}
    for s in raw_slices: series_groups.setdefault(s['series_uid'], []).append(s)
    new_series_list = []
    for uid, slices in series_groups.items():
        slices.sort(key=lambda s: s['slice_location'])
        try: volume = np.stack([s['pixel_array'] for s in slices], axis=0)
        except:
            min_h = min(s['pixel_array'].shape[0] for s in slices)
            min_w = min(s['pixel_array'].shape[1] for s in slices)
            volume = np.stack([s['pixel_array'][:min_h, :min_w] for s in slices], axis=0)
        ref = slices[0]
        axial, coronal, sagittal = build_mpr_slices(volume, ref['pixel_spacing'], ref['slice_thickness'], ref['window_center'], ref['window_width'], ref['rescale_intercept'], ref['rescale_slope'])
        # MODIFIED: Default to 0, 0 for front-facing view
        three_d_projection = build_3d_projection(volume, ref['pixel_spacing'], ref['slice_thickness'], ref['window_center'], ref['window_width'], ref['rescale_intercept'], ref['rescale_slope'], azimuth=0, elevation=0)
        series_counter[0] += 1
        sid = series_counter[0]
        
        # ─── FIXED CODE HERE ──────────────────────────────────────────────────
        # Store all volume arrays and parameters needed by build_3d_projection
        stored_series_meta[str(sid)] = {
            "axial_slices": axial, 
            "coronal_slices": coronal, 
            "sagittal_slices": sagittal, 
            "mip_3d": three_d_projection,
            "volume_3d": volume,
            "pixel_spacing": ref['pixel_spacing'],
            "slice_thickness": ref['slice_thickness'],
            "window_center": ref['window_center'],
            "window_width": ref['window_width'],
            "rescale_intercept": ref['rescale_intercept'],
            "rescale_slope": ref['rescale_slope']
        }
        # ──────────────────────────────────────────────────────────────────────
        
        for study in stored_worklist: study["current"] = False
        stored_worklist.insert(0, {"id": sid, "type": f"{ref['modality']} {ref['study_desc']}", "priority": "Medium", "date": ref['date'], "time": ref['time'], "current": True})
        new_series_list.append({"id": sid, "name": f"Series {sid}", "count": len(axial), "type": ref['modality'], "color": "#a855f7", "thumbnail": axial[len(axial) // 2]["image"]})
    return jsonify({"message": "Processing complete.", "new_series_list": new_series_list, "patient": stored_patients, "worklist": stored_worklist})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
