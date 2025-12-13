import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Link from '@mui/material/Link';
import FacebookIcon from '@mui/icons-material/Facebook';
import InstagramIcon from '@mui/icons-material/Instagram';

export default function Footer() {
  return (
    <Box
      sx={{
        backgroundColor: '#f9f9f9',
        borderTop: '4px solid #649a8b',
        padding: '50px 20px 30px',
        mt: 10,
      }}
    >
      {/* 主體內容：四欄 */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-around',
          gap: 6,
          maxWidth: 1200,
          margin: '0 auto',
        }}
      >
        {/* 第一欄 */}
        <Box sx={{ minWidth: 180 }}>
          <Typography
            fontWeight="bold"
            gutterBottom
            sx={{ color: '#649a8b', fontSize: 18 }}
          >
            Qui sommes-nous ?
          </Typography>
          {['Nos engagements', 'Le blog', 'Nous rejoindre', 'Mentions légales'].map(
            (text) => (
              <Typography key={text} sx={{ my: 0.5 }}>
                <Link
                  href="#"
                  underline="hover"
                  sx={{
                    color: '#555',
                    '&:hover': { color: '#649a8b' },
                  }}
                >
                  {text}
                </Link>
              </Typography>
            )
          )}
        </Box>

        {/* 第二欄 */}
        <Box sx={{ minWidth: 180 }}>
          <Typography
            fontWeight="bold"
            gutterBottom
            sx={{ color: '#649a8b', fontSize: 18 }}
          >
            Aide
          </Typography>
          {['Livraison', 'Paiement', 'Contact'].map((text) => (
            <Typography key={text} sx={{ my: 0.5 }}>
              <Link
                href="#"
                underline="hover"
                sx={{
                  color: '#555',
                  '&:hover': { color: '#649a8b' },
                }}
              >
                {text}
              </Link>
            </Typography>
          ))}
        </Box>

        {/* 第三欄 */}
        <Box sx={{ minWidth: 180 }}>
          <Typography
            fontWeight="bold"
            gutterBottom
            sx={{ color: '#649a8b', fontSize: 18 }}
          >
            Recyclage
          </Typography>
          {['Suggestions', 'Top plateformes', 'Nouveautés'].map((text) => (
            <Typography key={text} sx={{ my: 0.5 }}>
              <Link
                href="#"
                underline="hover"
                sx={{
                  color: '#555',
                  '&:hover': { color: '#649a8b' },
                }}
              >
                {text}
              </Link>
            </Typography>
          ))}
        </Box>

        {/* 第四欄 */}
        <Box sx={{ minWidth: 180 }}>
          <Typography
            fontWeight="bold"
            gutterBottom
            sx={{ color: '#649a8b', fontSize: 18 }}
          >
            Villes
          </Typography>
          {['Paris', 'Bordeaux', 'Lyon', 'Nantes', 'Strasbourg'].map((text) => (
            <Typography key={text} sx={{ color: '#555', my: 0.5 }}>
              {text}
            </Typography>
          ))}
        </Box>
      </Box>

      {/* 分隔線 */}
      <Box
        sx={{
          height: 1,
          backgroundColor: '#ddd',
          my: 5,
          maxWidth: 1200,
          mx: 'auto',
        }}
      />

      {/* Social Icons + Newsletter */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
        }}
      >
        {/* Social Icons */}
        <Box sx={{ display: 'flex', gap: 3 }}>
          <FacebookIcon
            sx={{ color: '#649a8b', fontSize: 32, cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
          />
          <InstagramIcon
            sx={{ color: '#649a8b', fontSize: 32, cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
          />
        </Box>

        {/* Newsletter */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            placeholder="Votre email"
            size="small"
            sx={{ backgroundColor: '#fff', borderRadius: 1 }}
          />
          <Button variant="contained" sx={{ backgroundColor: '#649a8b', '&:hover': { backgroundColor: '#4e7d71' } }}>
            S'abonner
          </Button>
        </Box>
      </Box>

      {/* 底部資訊 */}
      <Box
        sx={{
          mt: 5,
          textAlign: 'center',
          fontSize: 12,
          color: '#777',
        }}
      >
        PAIEMENT 100% SÉCURISÉ – CB / VISA / MASTERCARD
        <br />
        <span>© {new Date().getFullYear()} Recyclivre</span>
      </Box>
    </Box>
  );
}
