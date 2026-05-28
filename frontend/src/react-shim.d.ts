import 'react';
declare module 'react' {
  interface DOMAttributes<T> {
    children?: React.ReactNode | React.ReactNode[];
  }
}
