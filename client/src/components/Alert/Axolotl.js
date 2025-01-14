import { h, Fragment } from "preact";
import { useEffect } from "preact/hooks";
import classNames from "classnames";

import SVGClipPath from "../helpers/SVGClipPath";

import styles from "./Axolotl.css";

const getTextFromChildren = (children) => {
  let text = "";

  if (typeof children === "string") {
    text += children;
  }

  if (Array.isArray(children)) {
    children.forEach((child) => {
      text += getTextFromChildren(child);
    });
  }

  if (children?.props?.children) {
    text += getTextFromChildren(children.props.children);
  }

  if (text.trim() === "") {
    return "";
  }

  return text;
};

const Axolotl = ({ children, message, duration, containsHTML }) => {
  useEffect(() => {
    if (window.sayAnimalese) {
      setTimeout(() => {
        const text = message || getTextFromChildren(children);
        window.sayAnimalese(text);
      }, duration / 4);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Fragment>
      <SVGClipPath
        componentName="Axolotl__speech-bubble__text__image"
        width={300}
        height={300}
        path="M18.087 13.3c27.116-25.984 78.856.575 116.806-1.612 91.305-5.264 130.047-28.34 148.73 10.019 19.846 40.747 17.272 96.356 14.47 148.301-2.308 42.76-1.013 82.728-20.054 112.564-29.823 35.05-83.214 5.99-114.268 8.37-43.061 1.902-127.86 21.61-149.168-9.658C-8.09 245.724 2 209.946 3.69 153.796 5.14 105.602-5.414 35.82 18.087 13.3z"
      />

      <div
        className={styles.Axolotl}
        style={{ animationDuration: `${duration}ms` }}
      >
        <img
          className={styles["Axolotl__image"]}
          src="../../assets/alerts/axolotl.png"
          alt=""
        />
        <div
          className={styles["Axolotl__speech-bubble"]}
          style={{ animationDuration: `${duration}ms` }}
        >
          <img
            className={classNames(
              styles["Axolotl__speech-bubble__image"],
              styles["Axolotl__speech-bubble__image--top"]
            )}
            src="../../assets/alerts/axolotl-speech-bubble-body.svg"
            alt=""
          />
          <img
            className={classNames(
              styles["Axolotl__speech-bubble__image"],
              styles["Axolotl__speech-bubble__image--bottom"]
            )}
            src="../../assets/alerts/axolotl-speech-bubble-body.svg"
            alt=""
          />
          {containsHTML ? (
            <p
              className={styles["Axolotl__speech-bubble__text"]}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: children }}
            />
          ) : (
            <p className={styles["Axolotl__speech-bubble__text"]}>
              {children}
            </p>
          )}
        </div>
      </div>
    </Fragment>
  );
};

export default Axolotl;
