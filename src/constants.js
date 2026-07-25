// Hardcoded Lift coordinates for Ground Floor (GR)
export const LIFT_COORDINATES = {
  x: 5220.46912942509,
  y: 1681.3904907165097,
  label: "GR Lift / Elevator",
};

// Hardcoded Lift coordinates for First Floor (F1)
export const F1_LIFT_COORDINATES = {
  x: 5720.46912942509,
  y: 1681.3904907165097,
  label: "F1 Lift / Elevator",
};

// Hardcoded Cabinet coordinates for First Floor (F1)
export const CABINET_COORDINATES = {
  x: 5620.3,
  y: 2200.84,
  label: "Backend Cabinet Destination",
};

// Hardcoded Temp Dot coordinates for F1 Path (Lift -> N12 -> Temp Dot -> Cabinet)
export const TEMP_DOT_COORDINATES = {
  x: 5480.0,
  y: 2200.84,
  label: "Temp Intermediate Node",
};

// Separate Floor Map IDs from Juniper Mist API
export const FLOOR_MAP_IDS = {
  GR: "30141417-44ea-4982-993c-6225c9f08315", // MB3-F00 (Ground Floor - 8 nodes)
  F1: "cfa55e13-794f-4081-b1b7-e35f1ea67325", // MB3-F01 (First Floor - 37 nodes)
};
