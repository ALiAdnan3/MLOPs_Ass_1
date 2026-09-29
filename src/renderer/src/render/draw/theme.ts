import type { Zone } from '../../core/model/types'

/** Plan palettes: dark = lit drafting table, light/print = ink on paper (see docs/DESIGN_SYSTEM.md). */
export interface PlanTheme {
  name: 'dark' | 'light' | 'print'
  paper: string
  grid: string
  gridMajor: string
  wallFill: string
  wallStroke: string
  partitionFill: string
  railing: string
  virtual: string
  room: Record<Zone, string>
  roomStroke: string
  text: string
  textMuted: string
  dim: string
  opening: string
  glass: string
  furniture: string
  furnitureFill: string
  stair: string
  column: string
  beam: string
  lawn: string
  lawnMark: string
  paving: string
  water: string
  tree: string
  treeStroke: string
  plotLine: string
  road: string
  select: string
  hover: string
  snap: string
  electrical: string
  plumbing: string
  plumbingDrain: string
  lighting: string
}

export const DARK_PLAN: PlanTheme = {
  name: 'dark',
  paper: '#1A1C1F',
  grid: '#23272B',
  gridMajor: '#2D3237',
  wallFill: '#D6DADF',
  wallStroke: '#E8EBEE',
  partitionFill: '#AEB4BA',
  railing: '#8FA3B3',
  virtual: '#5B636B',
  room: { public: '#2A2824', semi: '#282823', private: '#232A31', service: '#262728', circulation: '#26282A', outdoor: '#212A22', void: '#1D1F22' },
  roomStroke: '#3A4046',
  text: '#E6E8EA',
  textMuted: '#98A0A8',
  dim: '#A3AAB2',
  opening: '#C9CED3',
  glass: '#7FB9D8',
  furniture: '#8C949C',
  furnitureFill: '#2C3136',
  stair: '#B4BBC2',
  column: '#F2F4F6',
  beam: '#6E8196',
  lawn: '#1F2B20',
  lawnMark: '#35503A',
  paving: '#2B2D30',
  water: '#1E3A48',
  tree: '#2C3F2E',
  treeStroke: '#4F7456',
  plotLine: '#C79A2A',
  road: '#202225',
  select: '#F0B823',
  hover: '#4DA8DA',
  snap: '#4DA8DA',
  electrical: '#E3A948',
  plumbing: '#4DA8DA',
  plumbingDrain: '#A0785A',
  lighting: '#F3D27A'
}

export const LIGHT_PLAN: PlanTheme = {
  name: 'light',
  paper: '#FFFFFF',
  grid: '#F0F2F4',
  gridMajor: '#E0E4E8',
  wallFill: '#1E2226',
  wallStroke: '#111416',
  partitionFill: '#3B4147',
  railing: '#5D7385',
  virtual: '#A7AEB5',
  room: { public: '#F7F3EC', semi: '#F6F4EE', private: '#EEF2F6', service: '#F1F1EF', circulation: '#F3F3F1', outdoor: '#EEF4EA', void: '#FFFFFF' },
  roomStroke: '#D4D8DC',
  text: '#1B1F24',
  textMuted: '#5F6872',
  dim: '#3E4650',
  opening: '#30363C',
  glass: '#4B8DB3',
  furniture: '#7A828B',
  furnitureFill: '#FFFFFF',
  stair: '#3A4046',
  column: '#101316',
  beam: '#6C8298',
  lawn: '#E6F0E0',
  lawnMark: '#A9C49C',
  paving: '#EEEEEC',
  water: '#CFE7F1',
  tree: '#D5E6CC',
  treeStroke: '#7FA170',
  plotLine: '#B07F00',
  road: '#E7E8EA',
  select: '#D99A00',
  hover: '#1F7FB5',
  snap: '#1F7FB5',
  electrical: '#B87400',
  plumbing: '#1F7FB5',
  plumbingDrain: '#8A5A38',
  lighting: '#C79100'
}

export const PRINT_PLAN: PlanTheme = { ...LIGHT_PLAN, name: 'print', grid: '#FFFFFF', gridMajor: '#FFFFFF' }
