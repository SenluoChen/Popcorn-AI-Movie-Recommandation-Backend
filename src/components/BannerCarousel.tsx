import Slider from "react-slick";
import { IconButton } from "@mui/material";
import { ArrowBackIos, ArrowForwardIos } from "@mui/icons-material";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";

function NextArrow(props: any) {
  const { onClick } = props;
  return (
    <IconButton
      onClick={onClick}
      sx={{
        position: "absolute",
        right: 10,
        top: "50%",
        transform: "translateY(-50%)",
      
        backgroundColor: "white",
        boxShadow: 2,
        "&:hover": { backgroundColor: "#f1f1f1" },
      }}
    >
      <ArrowForwardIos fontSize="small" />
    </IconButton>
  );
}

function PrevArrow(props: any) {
  const { onClick } = props;
  return (
    <IconButton
      onClick={onClick}
      sx={{
        position: "absolute",
        left: 10,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 2,
        backgroundColor: "white",
        boxShadow: 2,
        "&:hover": { backgroundColor: "#f1f1f1" },
      }}
    >
      <ArrowBackIos fontSize="small" />
    </IconButton>
  );
}

export default function BannerCarousel() {
  const settings = {
    dots: true,
    infinite: true,
    speed: 500,
    autoplay: true,
    autoplaySpeed: 3000,
    slidesToShow: 1,
    slidesToScroll: 1,
    nextArrow: <NextArrow />,
    prevArrow: <PrevArrow />,
    dotsClass: "slick-dots slick-thumb",
    appendDots: (dots: React.ReactNode) => (
      <div style={{ overflowX: "auto", overflowY: "hidden" }}>
        <ul
          style={{
            margin: 0,
            padding: 0,
            display: "flex",
            flexWrap: "nowrap",
            justifyContent: "center",
            gap: 6,
            listStyle: "none",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {dots}
        </ul>
      </div>
    ),
  };

  return (
    <div
      style={{
        width: "100%",
        margin: "0 auto",
        position: "relative",
      }}
    >
      <Slider {...settings}>
        <div>
          <div
            style={{
              width: "100%",
              height: 280,
              background: "#f2f2f2",
              borderRadius: 12,
            }}
          />
        </div>
      </Slider>
    </div>
  );
}
