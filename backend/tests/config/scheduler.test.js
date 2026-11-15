const { initializeScheduler, stopScheduler, getScheduledJobs } = require('../../config/scheduler');

describe('Scheduler', () => {
  afterEach(() => {
    stopScheduler();
  });

  test('should initialize scheduler with jobs', () => {
    initializeScheduler();
    const jobs = getScheduledJobs();
    expect(jobs.length).toBeGreaterThan(0);
  });

  test('should have secret-rotation-daily job', () => {
    initializeScheduler();
    const jobs = getScheduledJobs();
    const rotationJob = jobs.find((j) => j.name === 'secret-rotation-daily');

    expect(rotationJob).toBeDefined();
    expect(rotationJob.schedule).toBe('0 2 * * *');
    expect(rotationJob.active).toBe(true);
  });

  test('should stop all jobs', () => {
    initializeScheduler();
    expect(getScheduledJobs().length).toBeGreaterThan(0);

    stopScheduler();
    expect(getScheduledJobs().length).toBe(0);
  });

  test('should return jobs with correct structure', () => {
    initializeScheduler();
    const jobs = getScheduledJobs();

    jobs.forEach((job) => {
      expect(job).toHaveProperty('name');
      expect(job).toHaveProperty('schedule');
      expect(job).toHaveProperty('active');
      expect(typeof job.active).toBe('boolean');
    });
  });
});
