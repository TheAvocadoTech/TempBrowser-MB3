import { configureStore } from '@reduxjs/toolkit';
import floorReducer from './floorSlice';

export const store = configureStore({
  reducer: {
    floor: floorReducer,
  },
});
