import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from '@fluentui/react-components';

/**
 * ServiceBus Explorer themes: the Azure blue of the XrmToolBox version on top of balanced neutrals.
 * Light is a soft blue-grey (no glaring white canvas); dark is a "dim" slate rather than near-black.
 */

const azure: BrandVariants = {
    10: '#020f1c',
    20: '#051c33',
    30: '#062a4d',
    40: '#063866',
    50: '#044780',
    60: '#02569a',
    70: '#0066b5',
    80: '#0078d4',
    90: '#2886de',
    100: '#4595e3',
    110: '#5ea4e8',
    120: '#77b3ec',
    130: '#90c2f0',
    140: '#a9d1f4',
    150: '#c3e0f8',
    160: '#ddeffc',
};

export const lightTheme: Theme = {
    ...createLightTheme(azure),
    colorNeutralBackground1: '#ffffff',
    colorNeutralBackground1Hover: '#f3f5fa',
    colorNeutralBackground1Pressed: '#e9edf5',
    colorNeutralBackground1Selected: '#eceff7',
    colorNeutralBackground2: '#eef1f7',
    colorNeutralBackground3: '#f5f7fb',
    colorNeutralBackground4: '#e9edf4',
    colorNeutralForeground1: '#1e2433',
    colorNeutralForeground2: '#374151',
    colorNeutralForeground3: '#6b7385',
    colorNeutralForeground4: '#a0a7b4',
    colorNeutralStroke1: '#cfd6e3',
    colorNeutralStroke1Hover: '#b8c1d1',
    colorNeutralStroke2: '#e2e7ef',
    colorNeutralStroke3: '#eef1f6',
    colorNeutralStrokeAccessible: '#7a8599',
};

export const darkTheme: Theme = {
    ...createDarkTheme(azure),
    colorBrandForeground1: azure[120],
    colorBrandForeground2: azure[130],
    colorBrandForegroundLink: azure[120],
    colorNeutralBackground1: '#353b48',
    colorNeutralBackground1Hover: '#3d4452',
    colorNeutralBackground1Pressed: '#323845',
    colorNeutralBackground1Selected: '#414857',
    colorNeutralBackground2: '#2b303b',
    colorNeutralBackground3: '#3a4150',
    colorNeutralBackground4: '#2f3542',
    colorNeutralBackgroundDisabled: '#3a404c',
    colorNeutralForeground1: '#e9ecf2',
    colorNeutralForeground2: '#d3d8e2',
    colorNeutralForeground3: '#aab3c3',
    colorNeutralForeground4: '#8892a4',
    colorNeutralForegroundDisabled: '#7a8394',
    colorNeutralStroke1: '#566074',
    colorNeutralStroke1Hover: '#667186',
    colorNeutralStroke2: '#4a5365',
    colorNeutralStroke3: '#414959',
    colorNeutralStrokeAccessible: '#9aa3b4',
    colorNeutralStrokeDisabled: '#4a5263',
    colorSubtleBackgroundHover: '#3f4655',
    colorSubtleBackgroundPressed: '#363c49',
    colorTransparentBackgroundHover: '#3f4655',
    colorNeutralShadowAmbient: 'rgba(0, 0, 0, 0.18)',
    colorNeutralShadowKey: 'rgba(0, 0, 0, 0.22)',
};
