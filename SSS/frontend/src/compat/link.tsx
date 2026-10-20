import { forwardRef, type AnchorHTMLAttributes } from "react";
import { Link as RouterLink } from "react-router";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; prefetch?: boolean; replace?: boolean; scroll?: boolean };

/** next/link for the copied screens: the same props, React Router underneath. */
const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, prefetch, replace, scroll, ...rest }, ref) {
  void prefetch;
  void scroll;
  return <RouterLink ref={ref} to={href} replace={replace} {...rest} />;
});
export default Link;
