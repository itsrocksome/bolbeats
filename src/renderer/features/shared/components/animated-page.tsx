import type { ReactNode, Ref } from 'react';

import clsx from 'clsx';
import { motion } from 'motion/react';
import { createContext, forwardRef, useContext } from 'react';

import styles from './animated-page.module.css';

import { animationProps } from '/@/shared/components/animations/animation-props';

interface AnimatedPageProps {
    children: ReactNode;
    scroll?: boolean; // BolBeats: pages without their own scroll area (Home, Best parts, ...) scroll as a whole
}

// BolBeats: only the outermost page is the "main" landmark; a page inside a page (search, favourites) is a plain block
const InPage = createContext(false);

export const AnimatedPage = forwardRef(
    ({ children, scroll }: AnimatedPageProps, ref: Ref<HTMLDivElement>) => {
        const nested = useContext(InPage);
        const Tag = nested ? motion.div : motion.main;
        return (
            <InPage.Provider value>
                <Tag
                    className={clsx(styles.animatedPage, scroll && styles.scroll)}
                    ref={ref}
                    {...{
                        ...animationProps.fadeIn,
                        transition: { duration: 0.5, ease: 'anticipate' },
                    }}
                >
                    {children}
                </Tag>
            </InPage.Provider>
        );
    },
);
