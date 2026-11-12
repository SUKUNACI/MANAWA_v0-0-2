import { useState, useCallback } from 'react';
import { useSelector } from 'react-redux';

export const useApi = (apiFunction) => {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const { isConnected } = useSelector((state) => state.network);

  const execute = useCallback(
    async (...params) => {
      if (!isConnected) {
        setError('No internet connection');
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await apiFunction(...params);
        setData(response.data);
        return response.data;
      } catch (err) {
        const errorMessage = err.response?.data?.message || err.message || 'An error occurred';
        setError(errorMessage);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [apiFunction, isConnected]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return { data, isLoading, error, execute, reset };
};
