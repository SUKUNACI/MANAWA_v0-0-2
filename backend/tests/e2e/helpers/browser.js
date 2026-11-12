/**
 * Browser/HTTP Helper for E2E Tests
 * Handles API requests with authentication, session management
 */

const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000/api';

/**
 * E2E Test Client
 * Manages HTTP requests, authentication, and session state
 */
class TestClient {
  constructor(baseURL = API_BASE_URL) {
    this.baseURL = baseURL;
    this.token = null;
    this.refreshToken = null;
    this.userId = null;
    this.cookies = {};

    this.client = axios.create({
      baseURL,
      validateStatus: () => true, // Don't throw on any status code
      withCredentials: true,
    });

    // Intercept responses to capture tokens
    this.client.interceptors.response.use((response) => {
      if (response.data?.token) {
        this.token = response.data.token;
        this.client.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;
      }
      if (response.data?.refreshToken) {
        this.refreshToken = response.data.refreshToken;
      }
      if (response.data?.user?.id) {
        this.userId = response.data.user.id;
      }
      // Capture cookies
      if (response.headers['set-cookie']) {
        response.headers['set-cookie'].forEach((cookie) => {
          const [name] = cookie.split('=');
          this.cookies[name] = cookie;
        });
      }
      return response;
    });
  }

  /**
   * Set authentication token
   */
  setToken(token) {
    this.token = token;
    if (token) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete this.client.defaults.headers.common['Authorization'];
    }
  }

  /**
   * Clear authentication
   */
  clearAuth() {
    this.token = null;
    this.refreshToken = null;
    this.userId = null;
    this.cookies = {};
    delete this.client.defaults.headers.common['Authorization'];
  }

  /**
   * POST request
   */
  async post(url, data = {}, config = {}) {
    try {
      const response = await this.client.post(url, data, config);
      return response;
    } catch (error) {
      console.error(`POST ${url} failed:`, error.message);
      throw error;
    }
  }

  /**
   * GET request
   */
  async get(url, config = {}) {
    try {
      const response = await this.client.get(url, config);
      return response;
    } catch (error) {
      console.error(`GET ${url} failed:`, error.message);
      throw error;
    }
  }

  /**
   * PUT request
   */
  async put(url, data = {}, config = {}) {
    try {
      const response = await this.client.put(url, data, config);
      return response;
    } catch (error) {
      console.error(`PUT ${url} failed:`, error.message);
      throw error;
    }
  }

  /**
   * PATCH request
   */
  async patch(url, data = {}, config = {}) {
    try {
      const response = await this.client.patch(url, data, config);
      return response;
    } catch (error) {
      console.error(`PATCH ${url} failed:`, error.message);
      throw error;
    }
  }

  /**
   * DELETE request
   */
  async delete(url, config = {}) {
    try {
      const response = await this.client.delete(url, config);
      return response;
    } catch (error) {
      console.error(`DELETE ${url} failed:`, error.message);
      throw error;
    }
  }

  /**
   * Register a new user
   */
  async register(userData) {
    const response = await this.post('/auth/register', userData);
    if (response.status === 201 && response.data?.token) {
      this.setToken(response.data.token);
      this.userId = response.data.user?.id;
    }
    return response;
  }

  /**
   * Login
   */
  async login(email, password) {
    const response = await this.post('/auth/login', { email, password });
    if (response.status === 200 && response.data?.token) {
      this.setToken(response.data.token);
      this.userId = response.data.user?.id;
    }
    return response;
  }

  /**
   * Logout
   */
  async logout() {
    const response = await this.post('/auth/logout');
    this.clearAuth();
    return response;
  }

  /**
   * Refresh token
   */
  async refreshAccessToken() {
    const response = await this.post('/auth/refresh', {
      refreshToken: this.refreshToken,
    });
    if (response.status === 200 && response.data?.token) {
      this.setToken(response.data.token);
    }
    return response;
  }

  /**
   * Verify email
   */
  async verifyEmail(code) {
    return this.post('/verification/verify-email', { code });
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email) {
    return this.post('/auth/request-reset', { email });
  }

  /**
   * Reset password
   */
  async resetPassword(token, newPassword) {
    return this.post('/auth/reset-password', { token, newPassword });
  }

  /**
   * Wait for a condition with timeout
   */
  async waitFor(condition, timeoutMs = 5000, intervalMs = 100) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        if (await condition()) {
          return true;
        }
      } catch (err) {
        // Continue waiting
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
  }

  /**
   * Retry a request with exponential backoff
   */
  async retry(fn, maxRetries = 3, initialDelayMs = 100) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < maxRetries - 1) {
          const delay = initialDelayMs * Math.pow(2, i);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }
}

/**
 * Create a new test client
 */
function createTestClient(baseURL = API_BASE_URL) {
  return new TestClient(baseURL);
}

/**
 * Create multiple test clients for multi-user testing
 */
function createTestClients(count = 2) {
  return Array.from({ length: count }, () => createTestClient());
}

module.exports = {
  TestClient,
  createTestClient,
  createTestClients,
};
