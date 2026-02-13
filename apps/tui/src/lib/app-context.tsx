import type { ParentProps } from "solid-js";
import { createContext, useContext } from "solid-js";

type AppContextValue = {
    isMacOs: boolean;
};

const AppContext = createContext<AppContextValue>();

type AppContextProviderProps = ParentProps<{
    isMacOs: boolean;
}>;

export function AppContextProvider(props: AppContextProviderProps) {
    return <AppContext.Provider value={{ isMacOs: props.isMacOs }}>{props.children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error("useAppContext must be used within AppContextProvider");
    }
    return context;
}
