import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import * as propertyService from '@services/propertyService';

export const searchProperties = createAsyncThunk(
  'property/search',
  async (searchParams, { rejectWithValue }) => {
    try {
      const response = await propertyService.searchProperties(searchParams);
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: 'Search failed' });
    }
  }
);

export const fetchPropertyDetails = createAsyncThunk(
  'property/fetchDetails',
  async (propertyId, { rejectWithValue }) => {
    try {
      const response = await propertyService.getPropertyDetails(propertyId);
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: 'Failed to fetch property' });
    }
  }
);

export const fetchUserProperties = createAsyncThunk(
  'property/fetchUserProperties',
  async (_, { rejectWithValue }) => {
    try {
      const response = await propertyService.getUserProperties();
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: 'Failed to fetch properties' });
    }
  }
);

export const createProperty = createAsyncThunk(
  'property/create',
  async (propertyData, { rejectWithValue }) => {
    try {
      const response = await propertyService.createProperty(propertyData);
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: 'Failed to create property' });
    }
  }
);

const initialState = {
  searchResults: [],
  selectedProperty: null,
  userProperties: [],
  isLoading: false,
  error: null,
  totalCount: 0,
  page: 1,
  limit: 20,
  filters: {
    location: null,
    priceMin: null,
    priceMax: null,
    checkIn: null,
    checkOut: null,
    guests: 1,
  },
};

const propertySlice = createSlice({
  name: 'property',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setFilters: (state, action) => {
      state.filters = { ...state.filters, ...action.payload };
      state.page = 1;
    },
    clearFilters: (state) => {
      state.filters = initialState.filters;
      state.page = 1;
    },
    setPage: (state, action) => {
      state.page = action.payload;
    },
    clearSelectedProperty: (state) => {
      state.selectedProperty = null;
    },
  },
  extraReducers: (builder) => {
    // Search Properties
    builder
      .addCase(searchProperties.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(searchProperties.fulfilled, (state, action) => {
        state.isLoading = false;
        state.searchResults = action.payload.properties || action.payload;
        state.totalCount = action.payload.total || 0;
        state.error = null;
      })
      .addCase(searchProperties.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload?.message || 'Search failed';
      });

    // Fetch Property Details
    builder
      .addCase(fetchPropertyDetails.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchPropertyDetails.fulfilled, (state, action) => {
        state.isLoading = false;
        state.selectedProperty = action.payload;
        state.error = null;
      })
      .addCase(fetchPropertyDetails.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload?.message || 'Failed to fetch property';
      });

    // Fetch User Properties
    builder
      .addCase(fetchUserProperties.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchUserProperties.fulfilled, (state, action) => {
        state.isLoading = false;
        state.userProperties = action.payload.properties || action.payload;
        state.error = null;
      })
      .addCase(fetchUserProperties.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload?.message || 'Failed to fetch properties';
      });

    // Create Property
    builder
      .addCase(createProperty.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(createProperty.fulfilled, (state, action) => {
        state.isLoading = false;
        state.userProperties.unshift(action.payload);
        state.selectedProperty = action.payload;
        state.error = null;
      })
      .addCase(createProperty.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload?.message || 'Failed to create property';
      });
  },
});

export const { clearError, setFilters, clearFilters, setPage, clearSelectedProperty } =
  propertySlice.actions;
export default propertySlice.reducer;
