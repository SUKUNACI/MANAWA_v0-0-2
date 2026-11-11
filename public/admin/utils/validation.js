/**
 * MANAWA Admin Panel - Input Validation Schemas
 * Zod-like validation utilities for form data and API responses
 * Version 1.0
 */

/**
 * Base validation result object
 */
class ValidationResult {
  constructor(valid = true, errors = {}, data = null) {
    this.valid = valid;
    this.errors = errors;
    this.data = data;
  }
}

/**
 * Validate API Key creation form
 * @param {Object} formData - { name, permissions, description }
 * @returns {ValidationResult}
 */
function validateApiKeyCreation(formData) {
  const errors = {};

  if (!formData.name || typeof formData.name !== 'string') {
    errors.name = 'API Key name is required and must be a string';
  } else if (formData.name.trim().length < 3) {
    errors.name = 'API Key name must be at least 3 characters';
  } else if (formData.name.trim().length > 100) {
    errors.name = 'API Key name must not exceed 100 characters';
  }

  if (!formData.permissions || !Array.isArray(formData.permissions)) {
    errors.permissions = 'At least one permission must be selected';
  } else if (formData.permissions.length === 0) {
    errors.permissions = 'At least one permission must be selected';
  }

  if (formData.description && typeof formData.description !== 'string') {
    errors.description = 'Description must be a string';
  } else if (formData.description && formData.description.length > 500) {
    errors.description = 'Description must not exceed 500 characters';
  }

  const valid = Object.keys(errors).length === 0;
  return new ValidationResult(valid, errors, valid ? formData : null);
}

/**
 * Validate User creation form
 * @param {Object} formData - { email, password, role }
 * @returns {ValidationResult}
 */
function validateUserCreation(formData) {
  const errors = {};

  // Email validation
  if (!formData.email || typeof formData.email !== 'string') {
    errors.email = 'Email is required and must be a string';
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      errors.email = 'Email format is invalid';
    } else if (formData.email.length > 254) {
      errors.email = 'Email must not exceed 254 characters';
    }
  }

  // Password validation
  if (!formData.password || typeof formData.password !== 'string') {
    errors.password = 'Password is required and must be a string';
  } else if (formData.password.length < 8) {
    errors.password = 'Password must be at least 8 characters';
  } else if (formData.password.length > 128) {
    errors.password = 'Password must not exceed 128 characters';
  } else if (!/[A-Z]/.test(formData.password)) {
    errors.password = 'Password must contain at least one uppercase letter';
  } else if (!/[a-z]/.test(formData.password)) {
    errors.password = 'Password must contain at least one lowercase letter';
  } else if (!/[0-9]/.test(formData.password)) {
    errors.password = 'Password must contain at least one number';
  }

  // Role validation
  const validRoles = ['ADMIN', 'MODERATOR', 'SUPPORT', 'ANALYST'];
  if (!formData.role || typeof formData.role !== 'string') {
    errors.role = 'Role is required and must be a string';
  } else if (!validRoles.includes(formData.role)) {
    errors.role = `Role must be one of: ${validRoles.join(', ')}`;
  }

  const valid = Object.keys(errors).length === 0;
  return new ValidationResult(valid, errors, valid ? formData : null);
}

/**
 * Validate Badge creation form
 * @param {Object} formData - { name, icon, description, category }
 * @returns {ValidationResult}
 */
function validateBadgeCreation(formData) {
  const errors = {};

  if (!formData.name || typeof formData.name !== 'string') {
    errors.name = 'Badge name is required and must be a string';
  } else if (formData.name.trim().length < 2) {
    errors.name = 'Badge name must be at least 2 characters';
  } else if (formData.name.trim().length > 50) {
    errors.name = 'Badge name must not exceed 50 characters';
  }

  if (!formData.icon || typeof formData.icon !== 'string') {
    errors.icon = 'Badge icon is required and must be a string';
  } else if (formData.icon.trim().length === 0) {
    errors.icon = 'Badge icon cannot be empty';
  } else if (formData.icon.length > 100) {
    errors.icon = 'Badge icon must not exceed 100 characters';
  }

  if (formData.description && typeof formData.description !== 'string') {
    errors.description = 'Description must be a string';
  } else if (formData.description && formData.description.length > 300) {
    errors.description = 'Description must not exceed 300 characters';
  }

  if (!formData.category || typeof formData.category !== 'string') {
    errors.category = 'Category is required and must be a string';
  } else if (formData.category.length > 50) {
    errors.category = 'Category must not exceed 50 characters';
  }

  const valid = Object.keys(errors).length === 0;
  return new ValidationResult(valid, errors, valid ? formData : null);
}

/**
 * Validate API Response - Generic response structure
 * @param {Object} response - API response object
 * @returns {ValidationResult}
 */
function validateApiResponse(response) {
  const errors = {};

  if (!response || typeof response !== 'object') {
    return new ValidationResult(false, { response: 'Response must be an object' });
  }

  // Check for required fields
  if (response.success === undefined) {
    errors.success = 'Response must contain a success field';
  } else if (typeof response.success !== 'boolean') {
    errors.success = 'Success field must be a boolean';
  }

  // If success is true, validate data exists
  if (response.success === true && response.data === undefined) {
    errors.data = 'Successful response must contain data field';
  }

  // If success is false, validate error exists
  if (response.success === false && !response.error) {
    errors.error = 'Failed response must contain an error message';
  }

  const valid = Object.keys(errors).length === 0;
  return new ValidationResult(valid, errors, valid ? response : null);
}

/**
 * Validate Pagination parameters
 * @param {Object} params - { page, limit, sort, order }
 * @returns {ValidationResult}
 */
function validatePaginationParams(params) {
  const errors = {};

  // Validate page
  if (params.page !== undefined) {
    const pageNum = parseInt(params.page, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      errors.page = 'Page must be a positive integer';
    }
  }

  // Validate limit
  if (params.limit !== undefined) {
    const limitNum = parseInt(params.limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
      errors.limit = 'Limit must be between 1 and 1000';
    }
  }

  // Validate sort field
  if (params.sort && typeof params.sort !== 'string') {
    errors.sort = 'Sort must be a string';
  }

  // Validate order
  if (params.order && !['asc', 'desc'].includes(params.order.toLowerCase())) {
    errors.order = 'Order must be "asc" or "desc"';
  }

  const valid = Object.keys(errors).length === 0;
  return new ValidationResult(valid, errors, valid ? params : null);
}

/**
 * Validate filter criteria
 * @param {Object} filters - Various filter fields
 * @returns {ValidationResult}
 */
function validateFilterCriteria(filters) {
  const errors = {};

  // Status validation
  if (filters.status) {
    const validStatuses = ['ACTIVE', 'INACTIVE', 'PENDING', 'SUSPENDED', 'DELETED'];
    if (!validStatuses.includes(filters.status)) {
      errors.status = `Status must be one of: ${validStatuses.join(', ')}`;
    }
  }

  // Search string validation
  if (filters.search) {
    if (typeof filters.search !== 'string') {
      errors.search = 'Search must be a string';
    } else if (filters.search.length > 500) {
      errors.search = 'Search must not exceed 500 characters';
    }
  }

  // Date range validation
  if (filters.startDate || filters.endDate) {
    if (filters.startDate && isNaN(Date.parse(filters.startDate))) {
      errors.startDate = 'Start date must be a valid ISO date';
    }
    if (filters.endDate && isNaN(Date.parse(filters.endDate))) {
      errors.endDate = 'End date must be a valid ISO date';
    }
    if (filters.startDate && filters.endDate) {
      const start = new Date(filters.startDate);
      const end = new Date(filters.endDate);
      if (start > end) {
        errors.dateRange = 'Start date must be before end date';
      }
    }
  }

  const valid = Object.keys(errors).length === 0;
  return new ValidationResult(valid, errors, valid ? filters : null);
}

/**
 * Validate update action (generic)
 * @param {Object} data - Data to update
 * @param {string[]} allowedFields - List of allowed field names
 * @returns {ValidationResult}
 */
function validateUpdateAction(data, allowedFields = []) {
  const errors = {};

  if (!data || typeof data !== 'object') {
    return new ValidationResult(false, { data: 'Data must be an object' });
  }

  if (Object.keys(data).length === 0) {
    errors.data = 'At least one field must be provided for update';
  }

  if (allowedFields.length > 0) {
    const invalidFields = Object.keys(data).filter(k => !allowedFields.includes(k));
    if (invalidFields.length > 0) {
      errors.fields = `Invalid fields: ${invalidFields.join(', ')}. Allowed: ${allowedFields.join(', ')}`;
    }
  }

  const valid = Object.keys(errors).length === 0;
  return new ValidationResult(valid, errors, valid ? data : null);
}

/**
 * Combine multiple validation results
 * @param {...ValidationResult} results - Multiple validation results
 * @returns {ValidationResult}
 */
function combineValidations(...results) {
  const combinedErrors = {};
  let allValid = true;

  results.forEach((result, index) => {
    if (!result.valid) {
      allValid = false;
      Object.keys(result.errors).forEach(key => {
        const errorKey = `field_${index}_${key}`;
        combinedErrors[errorKey] = result.errors[key];
      });
    }
  });

  return new ValidationResult(allValid, combinedErrors);
}

// Export validation functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ValidationResult,
    validateApiKeyCreation,
    validateUserCreation,
    validateBadgeCreation,
    validateApiResponse,
    validatePaginationParams,
    validateFilterCriteria,
    validateUpdateAction,
    combineValidations,
  };
}
