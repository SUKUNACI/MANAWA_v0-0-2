const { thirdPartyApiConfig, getConfig, getEnabledServices, validateConfig } = require('../../config/third-party-api-config');

describe('Third Party API Config', () => {
  test('should have all required services configured', () => {
    expect(thirdPartyApiConfig.geniuspay).toBeDefined();
    expect(thirdPartyApiConfig.mailjet).toBeDefined();
    expect(thirdPartyApiConfig.twilio).toBeDefined();
    expect(thirdPartyApiConfig.redis).toBeDefined();
  });

  test('should have circuit breaker settings for each service', () => {
    for (const [service, config] of Object.entries(thirdPartyApiConfig)) {
      expect(config.circuitBreaker).toBeDefined();
      expect(config.circuitBreaker.failureThreshold).toBeGreaterThan(0);
      expect(config.circuitBreaker.failureTimeWindow).toBeGreaterThan(0);
      expect(config.circuitBreaker.resetTimeout).toBeGreaterThan(0);
    }
  });

  test('should have rate limiter settings for each service', () => {
    for (const [service, config] of Object.entries(thirdPartyApiConfig)) {
      expect(config.rateLimiter).toBeDefined();
      expect(config.rateLimiter.minimumRemaining).toBeGreaterThan(0);
      expect(config.rateLimiter.remainingThreshold).toBeGreaterThan(0);
    }
  });

  test('should get config for specific service', () => {
    const geniusPayConfig = getConfig('geniuspay');
    expect(geniusPayConfig).toBeDefined();
    expect(geniusPayConfig.serviceName).toBe('GeniusPay');

    const mailjetConfig = getConfig('mailjet');
    expect(mailjetConfig).toBeDefined();
    expect(mailjetConfig.serviceName).toBe('Mailjet');
  });

  test('should return null for unknown service', () => {
    const config = getConfig('unknown-service');
    expect(config).toBeNull();
  });

  test('should validate configuration', () => {
    const issues = validateConfig();
    expect(Array.isArray(issues)).toBe(true);
  });

  test('should have reasonable timeout values', () => {
    for (const [service, config] of Object.entries(thirdPartyApiConfig)) {
      expect(config.timeout).toBeGreaterThanOrEqual(5000); // At least 5 seconds
      expect(config.timeout).toBeLessThanOrEqual(60000); // At most 60 seconds
    }
  });

  test('should have circuit breaker thresholds >= 1', () => {
    for (const [service, config] of Object.entries(thirdPartyApiConfig)) {
      expect(config.circuitBreaker.failureThreshold).toBeGreaterThanOrEqual(1);
      expect(config.circuitBreaker.failureTimeWindow).toBeGreaterThanOrEqual(1000);
      expect(config.circuitBreaker.resetTimeout).toBeGreaterThanOrEqual(1000);
    }
  });

  test('should have rate limiter thresholds >= 1', () => {
    for (const [service, config] of Object.entries(thirdPartyApiConfig)) {
      expect(config.rateLimiter.minimumRemaining).toBeGreaterThanOrEqual(1);
      expect(config.rateLimiter.remainingThreshold).toBeGreaterThanOrEqual(1);
    }
  });

  test('GeniusPay should have payment-specific thresholds', () => {
    const config = getConfig('geniuspay');
    expect(config.serviceName).toBe('GeniusPay');
    expect(config.circuitBreaker.failureThreshold).toBe(5); // Default
    expect(config.rateLimiter.minimumRemaining).toBe(10);
  });

  test('Redis should have connection failure thresholds', () => {
    const config = getConfig('redis');
    expect(config.serviceName).toBe('Redis');
    // Redis has higher failure threshold for connection issues
    expect(config.circuitBreaker.failureThreshold).toBe(10);
  });

  test('Mailjet should have email-specific thresholds', () => {
    const config = getConfig('mailjet');
    expect(config.serviceName).toBe('Mailjet');
    expect(config.rateLimiter.minimumRemaining).toBe(20);
  });

  test('getEnabledServices respects enabled flag', () => {
    const enabledServices = getEnabledServices();
    expect(Array.isArray(enabledServices)).toBe(true);

    for (const service of enabledServices) {
      expect(service.enabled).toBe(true);
    }
  });
});
