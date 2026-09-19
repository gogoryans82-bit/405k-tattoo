
      (function() {
        var header = document.getElementById('header');
        if (!header) {
          return;
        }
        function setHeaderHeightVar() {
          document.documentElement.style.setProperty(
            '--header-height',
            header.getBoundingClientRect().height + 'px'
          );
        }
        setHeaderHeightVar();
        var images = header.getElementsByTagName('img');
        for (var i = 0; i < images.length; i++) {
          if (!images[i].complete) {
            images[i].addEventListener('load', setHeaderHeightVar);
          }
        }
      })();
      //# sourceURL=reserveSpaceForHeader.js
    
