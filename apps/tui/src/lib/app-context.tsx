import type { ParentProps } from "solid-js";
import { createContext, useContext } from "solid-js";
import type { CliOptions } from "./args";

interface AppContextValue {
	isMacOs: boolean;
	cliOptions: CliOptions;
}

const AppContext = createContext<AppContextValue>();

type AppContextProviderProps = ParentProps<{
	isMacOs: boolean;
	cliOptions: CliOptions;
}>;

export function AppContextProvider(props: AppContextProviderProps) {
	return (
		<AppContext.Provider
			value={{ isMacOs: props.isMacOs, cliOptions: props.cliOptions }}
		>
			{props.children}
		</AppContext.Provider>
	);
}

export function useAppContext(): AppContextValue {
	const context = useContext(AppContext);
	if (!context) {
		throw new Error("useAppContext must be used within AppContextProvider");
	}
	return context;
}
