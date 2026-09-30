// Port of legacy/src/misc/hungarian.{h,c}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// libhungarian by Cyrill Stachniss, 2004
//
// Solving the Minimum Assignment Problem using the Hungarian Method.
//
// ** This file may be freely copied and distributed! **
//
// Parts of the used code was originally provided by the "Stanford GraphGase", but I made changes to this code.
// As asked by the copyright node of the "Stanford GraphGase", I hereby proclaim that this file are *NOT* part of the
// "Stanford GraphGase" distrubition!
//
// This file is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied
// warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

export const HUNGARIAN_NOT_ASSIGNED = 0;
export const HUNGARIAN_ASSIGNED = 1;

export const HUNGARIAN_MODE_MINIMIZE_COST = 0;
export const HUNGARIAN_MODE_MAXIMIZE_UTIL = 1;

const INF = 0x7fffffff;

export class hungarian_problem_t {
  num_rows = 0;
  num_cols = 0;
  cost: number[][] = [];
  assignment: number[][] = [];
}

/** utility: row-major flat array -> rows x cols matrix (m[i][j] = array[i * cols + j]) */
export function array_to_matrix(m: ArrayLike<number>, rows: number, cols: number): number[][] {
  const r: number[][] = new Array(rows);
  for (let i = 0; i < rows; i++) {
    const row: number[] = new Array(cols);
    for (let j = 0; j < cols; j++) row[j] = m[i * cols + j];
    r[i] = row;
  }
  return r;
}

function hungarian_print_matrix(C: number[][], rows: number, cols: number): void {
  let s = '\n';
  for (let i = 0; i < rows; i++) {
    s += ' [';
    for (let j = 0; j < cols; j++) s += String(C[i][j]).padStart(5, ' ') + ' ';
    s += ']\n';
  }
  console.debug(s);
}

/** Print the computed optimal assignment. */
export function hungarian_print_assignment(p: hungarian_problem_t): void {
  hungarian_print_matrix(p.assignment, p.num_rows, p.num_cols);
}

/** Print the cost matrix. */
export function hungarian_print_costmatrix(p: hungarian_problem_t): void {
  hungarian_print_matrix(p.cost, p.num_rows, p.num_cols);
}

/** Print cost matrix and assignment matrix. */
export function hungarian_print_status(p: hungarian_problem_t): void {
  console.debug('cost:');
  hungarian_print_costmatrix(p);
  console.debug('assignment:');
  hungarian_print_assignment(p);
}

function hungarian_imax(a: number, b: number): number {
  return a < b ? b : a;
}

/**
 * This method initialize the hungarian_problem structure and init the cost matrices (missing lines or columns are
 * filled with 0). It returns the size of the quadratic(!) assignment matrix.
 */
export function hungarian_init(p: hungarian_problem_t, cost_matrix: number[][], rows: number, cols: number, mode: number): number {
  let max_cost = 0;

  const org_cols = cols;
  const org_rows = rows;

  // is the number of cols  not equal to number of rows ?
  // if yes, expand with 0-cols / 0-cols
  rows = hungarian_imax(cols, rows);
  cols = rows;

  p.num_rows = rows;
  p.num_cols = cols;

  p.cost = new Array(rows);
  p.assignment = new Array(rows);

  for (let i = 0; i < p.num_rows; i++) {
    const costRow: number[] = new Array(cols);
    const assignmentRow: number[] = new Array(cols);
    for (let j = 0; j < p.num_cols; j++) {
      costRow[j] = i < org_rows && j < org_cols ? cost_matrix[i][j] : 0;
      assignmentRow[j] = 0;
      if (max_cost < costRow[j]) max_cost = costRow[j];
    }
    p.cost[i] = costRow;
    p.assignment[i] = assignmentRow;
  }

  if (mode === HUNGARIAN_MODE_MAXIMIZE_UTIL) {
    for (let i = 0; i < p.num_rows; i++) {
      for (let j = 0; j < p.num_cols; j++) {
        p.cost[i][j] = max_cost - p.cost[i][j];
      }
    }
  } else if (mode === HUNGARIAN_MODE_MINIMIZE_COST) {
    // nothing to do
  } else {
    console.error('hungarian_init: unknown mode. Mode was set to HUNGARIAN_MODE_MINIMIZE_COST !');
  }

  return rows;
}

/** Free the memory allocated by init. */
export function hungarian_free(p: hungarian_problem_t): void {
  p.cost = [];
  p.assignment = [];
}

/** This method computes the optimal assignment. */
export function hungarian_solve(p: hungarian_problem_t): number {
  let i: number, j: number, k = 0, l = 0, s: number, t: number, q: number, unmatched: number;

  let cost = 0;
  const m = p.num_rows;
  const n = p.num_cols;

  const col_mate: number[] = new Array(m).fill(0);
  const unchosen_row: number[] = new Array(m).fill(0);
  const row_dec: number[] = new Array(m).fill(0);
  const slack_row: number[] = new Array(m).fill(0);

  const row_mate: number[] = new Array(n).fill(0);
  const parent_row: number[] = new Array(n).fill(0);
  const col_inc: number[] = new Array(n).fill(0);
  const slack: number[] = new Array(n).fill(0);

  const C = p.cost;

  for (i = 0; i < m; ++i) for (j = 0; j < n; ++j) p.assignment[i][j] = HUNGARIAN_NOT_ASSIGNED;

  // Begin subtract column minima in order to start with lots of zeroes 12
  for (l = 0; l < n; l++) {
    s = C[0][l];
    for (k = 1; k < m; k++) if (C[k][l] < s) s = C[k][l];
    cost += s;
    if (s !== 0) for (k = 0; k < m; k++) C[k][l] -= s;
  }
  // End subtract column minima in order to start with lots of zeroes 12

  // Begin initial state 16
  t = 0;
  for (l = 0; l < n; l++) {
    row_mate[l] = -1;
    parent_row[l] = -1;
    col_inc[l] = 0;
    slack[l] = INF;
  }
  for (k = 0; k < m; k++) {
    s = C[k][0];
    for (l = 1; l < n; l++) if (C[k][l] < s) s = C[k][l];
    row_dec[k] = s;
    let rowDone = false;
    for (l = 0; l < n; l++) {
      if (s === C[k][l] && row_mate[l] < 0) {
        col_mate[k] = l;
        row_mate[l] = k;
        rowDone = true; // C: goto row_done
        break;
      }
    }
    if (!rowDone) {
      col_mate[k] = -1;
      unchosen_row[t++] = k;
    }
  }
  // End initial state 16

  // Begin Hungarian algorithm 18
  if (t !== 0) {
    unmatched = t;
    done: while (true) {
      q = 0;
      breakthru: while (true) {
        while (q < t) {
          // Begin explore node q of the forest 19
          k = unchosen_row[q];
          s = row_dec[k];
          for (l = 0; l < n; l++) {
            if (slack[l]) {
              const del = C[k][l] - s + col_inc[l];
              if (del < slack[l]) {
                if (del === 0) {
                  if (row_mate[l] < 0) break breakthru;
                  slack[l] = 0;
                  parent_row[l] = k;
                  unchosen_row[t++] = row_mate[l];
                } else {
                  slack[l] = del;
                  slack_row[l] = k;
                }
              }
            }
          }
          // End explore node q of the forest 19
          q++;
        }

        // Begin introduce a new zero into the matrix 21
        s = INF;
        for (l = 0; l < n; l++) if (slack[l] && slack[l] < s) s = slack[l];
        for (q = 0; q < t; q++) row_dec[unchosen_row[q]] += s;
        for (l = 0; l < n; l++) {
          if (slack[l]) {
            slack[l] -= s;
            if (slack[l] === 0) {
              // Begin look at a new zero 22
              k = slack_row[l];
              if (row_mate[l] < 0) {
                for (j = l + 1; j < n; j++) if (slack[j] === 0) col_inc[j] += s;
                break breakthru;
              } else {
                parent_row[l] = k;
                unchosen_row[t++] = row_mate[l];
              }
              // End look at a new zero 22
            }
          } else {
            col_inc[l] += s;
          }
        }
        // End introduce a new zero into the matrix 21
      }

      // breakthru:
      // Begin update the matching 20
      while (true) {
        j = col_mate[k];
        col_mate[k] = l;
        row_mate[l] = k;
        if (j < 0) break;
        k = parent_row[j];
        l = j;
      }
      // End update the matching 20
      if (--unmatched === 0) break done;
      // Begin get ready for another stage 17
      t = 0;
      for (l = 0; l < n; l++) {
        parent_row[l] = -1;
        slack[l] = INF;
      }
      for (k = 0; k < m; k++) if (col_mate[k] < 0) unchosen_row[t++] = k;
      // End get ready for another stage 17
    }
  }
  // done:

  // Begin doublecheck the solution 23
  // PORT: the C code called exit(0) when the check failed; we throw instead.
  for (k = 0; k < m; k++)
    for (l = 0; l < n; l++) if (C[k][l] < row_dec[k] - col_inc[l]) throw new Error('hungarian_solve: solution check failed');
  for (k = 0; k < m; k++) {
    l = col_mate[k];
    if (l < 0 || C[k][l] !== row_dec[k] - col_inc[l]) throw new Error('hungarian_solve: solution check failed');
  }
  k = 0;
  for (l = 0; l < n; l++) if (col_inc[l]) k++;
  if (k > m) throw new Error('hungarian_solve: solution check failed');
  // End doublecheck the solution 23
  // End Hungarian algorithm 18

  for (i = 0; i < m; ++i) {
    p.assignment[i][col_mate[i]] = HUNGARIAN_ASSIGNED;
  }
  for (k = 0; k < m; ++k) {
    for (l = 0; l < n; ++l) {
      C[k][l] = C[k][l] - row_dec[k] + col_inc[l];
    }
  }
  for (i = 0; i < m; i++) cost += row_dec[i];
  for (i = 0; i < n; i++) cost -= col_inc[i];

  return cost;
}
