use strict;
use warnings;
use IO::Socket::INET;
use IO::Select;

# Servidor estatico minimo, solo para mirar el front en el navegador.
my ($root, $port) = @ARGV;
$port ||= 4173;

my %TIPO = (
  html => 'text/html; charset=utf-8',
  css  => 'text/css; charset=utf-8',
  js   => 'application/javascript; charset=utf-8',
  json => 'application/json; charset=utf-8',
  svg  => 'image/svg+xml',
  png  => 'image/png',
  jpg  => 'image/jpeg'
);

my $srv = IO::Socket::INET->new(
  LocalAddr => '127.0.0.1',
  LocalPort => $port,
  Proto     => 'tcp',
  Listen    => 16,
  ReuseAddr => 1
) or die "no escucha en $port: $!";

print "sirviendo $root en http://127.0.0.1:$port/\n";

while (my $c = $srv->accept) {
  # Este servidor atiende de a una conexion. Chrome abre varias de mas -- para
  # el `addAll` del service worker abre seis o siete a la vez -- y por algunas
  # no manda nunca nada. Sin este timeout, una conexion muda dejaba el servidor
  # bloqueado leyendo para siempre, y con el la pagina a medio cargar y el
  # service worker atascado en `installing`.
  #
  # Costo dos ratos de buscar un bug que no estaba en la app.
  unless (IO::Select->new($c)->can_read(2)) { close $c; next; }

  my $req = <$c>;
  next unless $req;
  while (my $l = <$c>) { last if $l =~ /^\r?\n$/ }

  my ($path) = $req =~ m{^GET\s+(\S+)};
  $path = '/' unless defined $path;
  $path =~ s/\?.*$//;
  $path =~ s/%20/ /g;
  # Indice de directorio: / y /gerencia/ resuelven a su index.html. Sin esto el
  # tablero daba 404 y la PWA andaba, que es la clase de diferencia que hace
  # dudar del codigo cuando el problema es del servidor de prueba.
  $path .= 'index.html' if $path =~ m{/$};
  $path =~ s{\.\.}{}g;

  my $file = $root . $path;
  if (-f $file) {
    my ($ext) = $file =~ /\.([a-z0-9]+)$/i;
    my $tipo = $TIPO{ lc($ext || '') } || 'application/octet-stream';
    open(my $fh, '<:raw', $file);
    local $/;
    my $body = <$fh>;
    close $fh;
    print $c "HTTP/1.0 200 OK\r\nContent-Type: $tipo\r\nContent-Length: " . length($body)
      . "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
    print $c $body;
  } else {
    print $c "HTTP/1.0 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
  }
  close $c;
}
