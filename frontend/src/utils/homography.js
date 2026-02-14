/**
 * Homography and Perspective Transformation Utilities
 *
 * Compute homography matrix from 4 point correspondences and transform points
 * between perspective-distorted image space and calibrated real-world space.
 */

/**
 * Solve linear system Ax = b using Gaussian elimination
 * @param {number[][]} A - Matrix A
 * @param {number[]} b - Vector b
 * @returns {number[]} Solution vector x
 */
function solveLinearSystem(A, b) {
  const n = A.length;
  const augmented = A.map((row, i) => [...row, b[i]]);

  // Forward elimination
  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

    // Make all rows below this one 0 in current column
    for (let k = i + 1; k < n; k++) {
      const factor = augmented[k][i] / augmented[i][i];
      for (let j = i; j <= n; j++) {
        augmented[k][j] -= factor * augmented[i][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = augmented[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= augmented[i][j] * x[j];
    }
    x[i] /= augmented[i][i];
  }

  return x;
}

/**
 * Compute homography matrix from 4 point correspondences
 *
 * Given 4 points in source image and their corresponding positions in destination,
 * compute the 3x3 homography matrix H such that dst = H * src
 *
 * @param {Array<{x: number, y: number}>} srcPoints - 4 points in source (image coordinates)
 * @param {Array<{x: number, y: number}>} dstPoints - 4 corresponding points in destination (normalized/real coordinates)
 * @returns {number[][]} 3x3 homography matrix
 */
export function computeHomography(srcPoints, dstPoints) {
  if (srcPoints.length !== 4 || dstPoints.length !== 4) {
    throw new Error('Exactly 4 point correspondences required');
  }

  // Build the system of equations
  // For each point correspondence, we get 2 equations:
  // x' = (h00*x + h01*y + h02) / (h20*x + h21*y + h22)
  // y' = (h10*x + h11*y + h12) / (h20*x + h21*y + h22)
  //
  // Rearranged to be linear in h:
  // -h00*x - h01*y - h02 + h20*x'*x + h21*x'*y + h22*x' = 0
  // -h10*x - h11*y - h12 + h20*y'*x + h21*y'*y + h22*y' = 0

  const A = [];
  const b = [];

  for (let i = 0; i < 4; i++) {
    const src = srcPoints[i];
    const dst = dstPoints[i];

    // First equation (for x')
    A.push([
      -src.x, -src.y, -1,
      0, 0, 0,
      dst.x * src.x, dst.x * src.y
    ]);
    b.push(-dst.x);

    // Second equation (for y')
    A.push([
      0, 0, 0,
      -src.x, -src.y, -1,
      dst.y * src.x, dst.y * src.y
    ]);
    b.push(-dst.y);
  }

  // Solve the system
  const h = solveLinearSystem(A, b);

  // Construct the 3x3 matrix (h22 = 1 by convention)
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1]
  ];
}

/**
 * Transform a point using homography matrix
 *
 * @param {{x: number, y: number}} point - Point to transform
 * @param {number[][]} H - 3x3 homography matrix
 * @returns {{x: number, y: number}} Transformed point
 */
export function perspectiveTransform(point, H) {
  const x = point.x;
  const y = point.y;

  // Homogeneous coordinates: [x, y, 1]
  // Transformed: [x', y', w'] = H * [x, y, 1]
  // Result: (x'/w', y'/w')

  const w = H[2][0] * x + H[2][1] * y + H[2][2];

  if (Math.abs(w) < 1e-10) {
    throw new Error('Division by zero in perspective transform');
  }

  return {
    x: (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
    y: (H[1][0] * x + H[1][1] * y + H[1][2]) / w
  };
}

/**
 * Calculate real-world distance between two points after perspective correction
 *
 * @param {{x: number, y: number}} p1 - First point in image coordinates
 * @param {{x: number, y: number}} p2 - Second point in image coordinates
 * @param {number[][]} H - Homography matrix
 * @param {{width: number, height: number}} realDimensions - Real-world dimensions of the calibrated plane
 * @returns {number} Distance in real-world units (same as realDimensions)
 */
export function calculateRealDistance(p1, p2, H, realDimensions) {
  // Transform both points to normalized space (0-1)
  const t1 = perspectiveTransform(p1, H);
  const t2 = perspectiveTransform(p2, H);

  // Calculate normalized distance
  const dx = t2.x - t1.x;
  const dy = t2.y - t1.y;

  // Scale by real dimensions
  const realDx = dx * realDimensions.width;
  const realDy = dy * realDimensions.height;

  // Euclidean distance
  return Math.sqrt(realDx * realDx + realDy * realDy);
}

/**
 * Invert a 3x3 homography matrix
 *
 * @param {number[][]} H - 3x3 homography matrix
 * @returns {number[][]} Inverted matrix
 */
export function invertHomography(H) {
  // Calculate determinant
  const det =
    H[0][0] * (H[1][1] * H[2][2] - H[1][2] * H[2][1]) -
    H[0][1] * (H[1][0] * H[2][2] - H[1][2] * H[2][0]) +
    H[0][2] * (H[1][0] * H[2][1] - H[1][1] * H[2][0]);

  if (Math.abs(det) < 1e-10) {
    throw new Error('Matrix is singular, cannot invert');
  }

  // Calculate cofactor matrix
  const inv = [
    [
      (H[1][1] * H[2][2] - H[1][2] * H[2][1]) / det,
      (H[0][2] * H[2][1] - H[0][1] * H[2][2]) / det,
      (H[0][1] * H[1][2] - H[0][2] * H[1][1]) / det
    ],
    [
      (H[1][2] * H[2][0] - H[1][0] * H[2][2]) / det,
      (H[0][0] * H[2][2] - H[0][2] * H[2][0]) / det,
      (H[0][2] * H[1][0] - H[0][0] * H[1][2]) / det
    ],
    [
      (H[1][0] * H[2][1] - H[1][1] * H[2][0]) / det,
      (H[0][1] * H[2][0] - H[0][0] * H[2][1]) / det,
      (H[0][0] * H[1][1] - H[0][1] * H[1][0]) / det
    ]
  ];

  return inv;
}

/**
 * Check if a point is within the calibrated area
 *
 * @param {{x: number, y: number}} point - Point in image coordinates
 * @param {number[][]} H - Homography matrix
 * @returns {boolean} True if point is within normalized bounds (0-1, 0-1)
 */
export function isPointInCalibration(point, H) {
  try {
    const transformed = perspectiveTransform(point, H);
    return transformed.x >= 0 && transformed.x <= 1 &&
           transformed.y >= 0 && transformed.y <= 1;
  } catch (e) {
    return false;
  }
}
