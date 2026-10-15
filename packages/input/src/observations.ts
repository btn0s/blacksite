export type GamepadApiState = 'available' | 'error' | 'unavailable';
export type GamepadMappingState = 'none' | 'nonstandard' | 'standard';
export type GamepadLayoutState = 'generic' | 'playstation' | 'xbox';

export interface GamepadButtonObservation {
  readonly pressed: boolean;
  readonly value: number;
}

export interface GamepadActionObservation {
  readonly name: string;
  readonly pressed: boolean;
  readonly value: { readonly x: number; readonly y: number };
}

export interface GamepadSelectionObservation {
  readonly axes: ReadonlyArray<number>;
  readonly buttons: ReadonlyArray<GamepadButtonObservation>;
  readonly id: string;
  readonly index: number;
  readonly layout: GamepadLayoutState;
  readonly mapping: GamepadMappingState;
}

export interface GamepadObservation {
  readonly actions: ReadonlyArray<GamepadActionObservation>;
  readonly api: GamepadApiState;
  readonly atMs: number;
  readonly buttonPresses: number;
  readonly contexts: ReadonlyArray<string>;
  readonly detectedPads: number;
  readonly pollErrors: number;
  readonly selected: GamepadSelectionObservation | null;
}

export interface GamepadActionSummary {
  readonly activeSamples: number;
  readonly name: string;
  readonly presses: number;
}

export interface GamepadTelemetrySummary {
  readonly actionSummaries: ReadonlyArray<GamepadActionSummary>;
  readonly activeContexts: ReadonlyArray<string>;
  readonly api: GamepadApiState;
  readonly axisPeaks: ReadonlyArray<number>;
  readonly buttonPresses: number;
  readonly buttonSamples: number;
  readonly connectedPadsMax: number;
  readonly connections: number;
  readonly detectedSamples: number;
  readonly disconnections: number;
  readonly layout: GamepadLayoutState;
  readonly mapping: GamepadMappingState;
  readonly pollErrors: number;
  readonly stickSamples: number;
}
