module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-reanimated/plugin',
      [
        'module-resolver',
        {
          alias: {
            '@': './src',
            '@screens': './src/screens',
            '@components': './src/components',
            '@services': './src/services',
            '@store': './src/store',
            '@utils': './src/utils',
            '@navigation': './src/navigation',
            '@hooks': './src/hooks',
            '@assets': './assets',
          },
        },
      ],
    ],
  };
};
