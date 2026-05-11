import { type AppType } from "next/app";
import { Geist } from "next/font/google";

import { api } from "~/utils/api";

// oxlint-disable-next-line import/no-unassigned-import -- Next.js loads global CSS through this side-effect import.
import "~/styles/globals.css";

const geist = Geist({
  subsets: ["latin"],
});

const MyApp: AppType = ({ Component, pageProps }) => {
  return (
    <div className={geist.className}>
      <Component {...pageProps} />
    </div>
  );
};

export default api.withTRPC(MyApp);
