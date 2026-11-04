import { createContext, useContext } from 'react';
import { getStrings, type Strings } from './strings';

export const I18nContext = createContext<Strings>(getStrings('en'));

export const useStrings = () => useContext(I18nContext);
